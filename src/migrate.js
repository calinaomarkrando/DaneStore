import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './db.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = await readFile(resolve('db/migrations/001_initial.sql'), 'utf8');
await pool.query(sql);
console.log('Database migration completed.');
await pool.end();
