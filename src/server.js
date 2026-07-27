import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pool, query } from './db.js';
import { comparePassword, hashPassword, publicUser, requireAdmin, requireAuth, signToken } from './auth.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

const page = value => Math.max(1, Number.parseInt(value, 10) || 1);
const limit = value => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 20));
const fail = (res, status, error) => res.status(status).json({ error });
const isText = (value, max = 5000) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const orderRow = row => ({ ...row, subtotal: row.subtotal_cents / 100, items: row.items || [] });

app.get('/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, username, password } = req.body;
  if (!isText(name, 120) || !isText(username, 64) || !isText(password, 128) || (!isText(email, 254) && !isText(phone, 32))) return fail(res, 400, 'Name, username, password, and email or phone are required');
  if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  try {
    const result = await query('INSERT INTO users (name,email,phone,username,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,phone,username,role,created_at', [name.trim(), email?.trim() || null, phone?.trim() || null, username.trim(), await hashPassword(password)]);
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return fail(res, 409, 'Email, phone, or username is already in use');
    throw error;
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!isText(identifier, 254) || !isText(password, 128)) return fail(res, 400, 'Identifier and password are required');
  const result = await query('SELECT * FROM users WHERE email=$1 OR phone=$1 OR username=$1 LIMIT 1', [identifier.trim()]);
  const user = result.rows[0];
  if (!user || !(await comparePassword(password, user.password_hash))) return fail(res, 401, 'Invalid sign-in details');
  res.json({ token: signToken(user), user: publicUser(user) });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/products', async (req, res) => {
  const take = limit(req.query.limit), skip = (page(req.query.page) - 1) * take, category = req.query.category;
  const values = [take, skip];
  const categoryClause = category ? 'AND p.category=$3' : '';
  if (category) values.push(category);
  const result = await query(`SELECT p.*, COALESCE(json_agg(json_build_object('id',m.id,'url',m.url,'type',m.media_type,'position',m.position) ORDER BY m.position) FILTER (WHERE m.id IS NOT NULL),'[]') AS media FROM products p LEFT JOIN product_media m ON m.product_id=p.id WHERE p.is_active=true ${categoryClause} GROUP BY p.id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, values);
  res.json({ data: result.rows.map(product => ({ ...product, price: product.price_cents / 100 })), page: page(req.query.page), limit: take });
});
app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, category, price, description, color = '#d8e2c6', artColor = '#395541', media = [] } = req.body;
  if (!isText(name, 200) || !['Clothing', 'Accessories', 'Lifestyle'].includes(category) || !Number.isFinite(price) || price < 0 || !isText(description, 5000)) return fail(res, 400, 'Invalid product data');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('INSERT INTO products (name,category,price_cents,description,color,art_color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [name.trim(), category, Math.round(price * 100), description.trim(), color, artColor]);
    for (const [position, item] of media.slice(0, 10).entries()) if (isText(item.url, 2048) && ['image', 'video'].includes(item.type)) await client.query('INSERT INTO product_media (product_id,url,media_type,position) VALUES ($1,$2,$3,$4)', [result.rows[0].id, item.url, item.type, position]);
    await client.query('COMMIT');
    res.status(201).json({ product: { ...result.rows[0], price: result.rows[0].price_cents / 100 } });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.post('/api/orders', requireAuth, async (req, res) => {
  const { items, shipping, paymentMethod } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 100 || !shipping || !isText(paymentMethod, 100) || !isText(shipping.name, 120) || !isText(shipping.phone, 32) || !isText(shipping.address, 1000)) return fail(res, 400, 'Complete order, payment, and shipping details are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = items.map(item => item.productId);
    const products = await client.query('SELECT id,name,price_cents FROM products WHERE id = ANY($1::uuid[]) AND is_active=true FOR SHARE', [ids]);
    if (products.rowCount !== new Set(ids).size) { await client.query('ROLLBACK'); return fail(res, 400, 'One or more products are unavailable'); }
    const byId = new Map(products.rows.map(product => [product.id, product]));
    const lines = items.map(item => ({ product: byId.get(item.productId), quantity: Number(item.quantity) }));
    if (lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99)) { await client.query('ROLLBACK'); return fail(res, 400, 'Invalid item quantities'); }
    const subtotal = lines.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
    const order = await client.query('INSERT INTO orders (customer_id,payment_method,shipping_name,shipping_email,shipping_phone,shipping_address,subtotal_cents) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.user.id, paymentMethod.trim(), shipping.name?.trim(), shipping.email?.trim() || null, shipping.phone?.trim(), shipping.address?.trim(), subtotal]);
    for (const line of lines) await client.query('INSERT INTO order_items (order_id,product_id,product_name,unit_price_cents,quantity) VALUES ($1,$2,$3,$4,$5)', [order.rows[0].id, line.product.id, line.product.name, line.product.price_cents, line.quantity]);
    await client.query('COMMIT');
    res.status(201).json({ order: orderRow(order.rows[0]) });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const take = limit(req.query.limit), skip = (page(req.query.page) - 1) * take;
  const isAdmin = req.user.role === 'admin';
  const result = await query(`SELECT o.*, u.name AS customer_name, COALESCE(json_agg(json_build_object('productId',i.product_id,'name',i.product_name,'price',i.unit_price_cents / 100.0,'quantity',i.quantity)) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM orders o JOIN users u ON u.id=o.customer_id LEFT JOIN order_items i ON i.order_id=o.id ${isAdmin ? '' : 'WHERE o.customer_id=$3'} GROUP BY o.id,u.name ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`, isAdmin ? [take, skip] : [take, skip, req.user.id]);
  res.json({ data: result.rows.map(orderRow), page: page(req.query.page), limit: take });
});
app.patch('/api/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
  if (!['new', 'processing', 'shipped', 'delivered', 'cancelled'].includes(req.body.status)) return fail(res, 400, 'Invalid order status');
  const result = await query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
  if (!result.rowCount) return fail(res, 404, 'Order not found');
  res.json({ order: orderRow(result.rows[0]) });
});
app.post('/api/orders/:id/cancel', requireAuth, async (req, res) => {
  const result = await query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1 AND customer_id=$2 AND status IN ('new','processing') RETURNING *", [req.params.id, req.user.id]);
  if (!result.rowCount) return fail(res, 409, 'Order cannot be cancelled');
  res.json({ order: orderRow(result.rows[0]) });
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  const archived = req.query.archived === 'true', take = limit(req.query.limit), skip = (page(req.query.page) - 1) * take;
  const where = req.user.role === 'admin' ? 'c.archived_at IS NOT DISTINCT FROM $1' : 'c.customer_id=$2';
  const values = req.user.role === 'admin' ? [archived ? null : null, take, skip] : [null, req.user.id, take, skip];
  const result = await query(`SELECT c.*,u.name AS customer_name,p.name AS product_name FROM conversations c JOIN users u ON u.id=c.customer_id LEFT JOIN products p ON p.id=c.product_id WHERE ${req.user.role === 'admin' ? (archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL') : where} ORDER BY c.updated_at DESC LIMIT $${req.user.role === 'admin' ? 1 : 3} OFFSET $${req.user.role === 'admin' ? 2 : 4}`, req.user.role === 'admin' ? [take, skip] : [null, req.user.id, take, skip]);
  res.json({ data: result.rows });
});
const conversationFor = async (id, user) => {
  const result = await query('SELECT * FROM conversations WHERE id=$1', [id]);
  const conversation = result.rows[0];
  if (!conversation || (user.role !== 'admin' && conversation.customer_id !== user.id)) return null;
  return conversation;
};
app.post('/api/conversations', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return fail(res, 403, 'Admins cannot open customer conversations');
  const productId = req.body.productId || null;
  const result = await query('INSERT INTO conversations (customer_id,product_id) VALUES ($1,$2) RETURNING *', [req.user.id, productId]);
  res.status(201).json({ conversation: result.rows[0] });
});
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  if (!(await conversationFor(req.params.id, req.user))) return fail(res, 404, 'Conversation not found');
  const take = limit(req.query.limit), skip = (page(req.query.page) - 1) * take;
  const result = await query('SELECT m.*,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at DESC LIMIT $2 OFFSET $3', [req.params.id, take, skip]);
  res.json({ data: result.rows.reverse(), page: page(req.query.page), limit: take });
});
app.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  if (!isText(req.body.body, 5000)) return fail(res, 400, 'Message text is required');
  const conversation = await conversationFor(req.params.id, req.user);
  if (!conversation) return fail(res, 404, 'Conversation not found');
  const result = await query('INSERT INTO messages (conversation_id,sender_id,body) VALUES ($1,$2,$3) RETURNING *', [conversation.id, req.user.id, req.body.body.trim()]);
  await query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversation.id]);
  res.status(201).json({ message: result.rows[0] });
});
app.patch('/api/conversations/:id/archive', requireAuth, requireAdmin, async (req, res) => {
  const result = await query('UPDATE conversations SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END,updated_at=now() WHERE id=$2 RETURNING *', [Boolean(req.body.archived), req.params.id]);
  if (!result.rowCount) return fail(res, 404, 'Conversation not found');
  res.json({ conversation: result.rows[0] });
});
app.delete('/api/conversations/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await query('DELETE FROM conversations WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rowCount) return fail(res, 404, 'Conversation not found');
  res.status(204).end();
});
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });
app.listen(process.env.PORT || 3000, () => console.log(`API listening on port ${process.env.PORT || 3000}`));
