import { query } from './db.js';

const starterProducts = [
  ['Field Day Tote', 'Accessories', 28, '#d8e2c6', '#395541', 'A sturdy everyday tote in washed canvas, with plenty of room for all the little things.'],
  ['Cloud Cotton Tee', 'Clothing', 34, '#edd7cf', '#f1ece2', 'The tee that earns a permanent spot in your rotation. Soft, breathable and relaxed.'],
  ['Weekend Cap', 'Accessories', 22, '#d2d8e7', '#304162', 'An unstructured cotton cap with a subtle embroidered Danes mark.'],
  ['Ribbed Water Bottle', 'Lifestyle', 25, '#e9ddb8', '#d66c45', 'A cheerful stainless steel bottle made to tag along everywhere.'],
  ['Everyday Overshirt', 'Clothing', 62, '#ccd9d2', '#647c6b', 'A layerable shirt-jacket with an easy fit and a crisp finish.'],
  ['Lucky Key Ring', 'Accessories', 14, '#f0d5c4', '#ef7f4e', 'A bright little key ring for keeping the important stuff together.'],
  ['Sunday Candle', 'Lifestyle', 30, '#dfd9ed', '#796589', 'Soft notes of bergamot, cedar and a slow Sunday morning.'],
  ['Easy Day Socks', 'Clothing', 16, '#dae9e5', '#7db2a8', 'A two-pack of soft everyday socks.']
];

export async function ensureCatalog() {
  const { rows } = await query('SELECT count(*)::int AS count FROM products');
  if (rows[0].count) return false;
  for (const [name, category, price, color, artColor, description] of starterProducts) {
    await query('INSERT INTO products (name,category,price_cents,description,color,art_color) VALUES ($1,$2,$3,$4,$5,$6)', [name, category, Math.round(price * 100), description, color, artColor]);
  }
  return true;
}
