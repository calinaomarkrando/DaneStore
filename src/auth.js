import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

export const isAuthConfigured = () => typeof process.env.JWT_SECRET === 'string' && process.env.JWT_SECRET.trim().length >= 32;
const secret = () => {
  if (!isAuthConfigured()) throw new Error('JWT_SECRET must be at least 32 characters');
  return process.env.JWT_SECRET;
};
export const publicUser = user => ({ id: user.id, name: user.name, email: user.email, phone: user.phone, username: user.username, role: user.role, createdAt: user.created_at });
export const signToken = user => jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: '7d' });

export async function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const claims = jwt.verify(token, secret());
    const result = await query('SELECT id,name,email,phone,username,role,created_at FROM users WHERE id=$1', [claims.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = result.rows[0];
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
export const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });
export const hashPassword = password => bcrypt.hash(password, 12);
export const comparePassword = (password, hash) => bcrypt.compare(password, hash);
