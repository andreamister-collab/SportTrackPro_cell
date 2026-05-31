// ============================================================
// SportTrackPro — Turso API Server (Node.js / Express)
// Sostituisce il client Supabase con una REST API custom
// 
// Install: npm install express @libsql/client bcryptjs jsonwebtoken cors dotenv
// Start:   node 02_api_server.js
// ============================================================

import express from 'express';
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import 'dotenv/config';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());

// ── Turso client ──────────────────────────────────────────────
const db = createClient({
    url:       process.env.TURSO_DATABASE_URL,   // libsql://xxx.turso.io
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── JWT helpers ───────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES = '7d';

const signToken  = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
const verifyJWT  = (token)   => jwt.verify(token, JWT_SECRET);

// ── Auth middleware ───────────────────────────────────────────
const auth = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non autenticato' });
    try {
        req.user = verifyJWT(token);
        next();
    } catch {
        res.status(401).json({ error: 'Token non valido o scaduto' });
    }
};

// ── Query builder helper ──────────────────────────────────────
// Converts a simple filter object to WHERE clause + args
const buildWhere = (filters = {}) => {
    const clauses = [];
    const args    = {};
    Object.entries(filters).forEach(([col, val]) => {
        if (val === undefined || val === null) return;
        if (Array.isArray(val)) {
            const keys = val.map((_, i) => `:${col}_${i}`);
            val.forEach((v, i) => { args[`${col}_${i}`] = v; });
            clauses.push(`${col} IN (${keys.join(',')})`);
        } else {
            clauses.push(`${col} = :${col}`);
            args[col] = val;
        }
    });
    return {
        sql:  clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        args,
    };
};

// ── Generic table endpoints ───────────────────────────────────
// GET  /api/:table          — list (with optional ?filters as JSON)
// GET  /api/:table/:id      — single row
// POST /api/:table          — insert
// PUT  /api/:table/:id      — update
// DELETE /api/:table/:id    — delete

// Allowed tables (security whitelist)
const ALLOWED_TABLES = new Set([
    'sports','societies','seasons','categories','teams','session_types',
    'athletes','athlete_team_seasons','parent_athletes',
    'sessions','attendances','match_details','match_stats',
    'test_definitions','test_performances','test_sessions','test_attendances','test_results',
    'tournaments','tournament_phases','tournament_groups',
    'tournament_group_teams','tournament_matches','tournament_phase_matches',
    'users','user_category_seasons',
]);

const uuid = () => {
    // Generate UUID-like string (hex randomblob equivalent in JS)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
};

// GET /api/:table
app.get('/api/:table', auth, async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const order   = req.query.order   || '';
        const limit   = parseInt(req.query.limit) || 1000;
        const { sql: where, args } = buildWhere(filters);

        const orderClause = order ? `ORDER BY ${order}` : '';
        const result = await db.execute({
            sql:  `SELECT * FROM ${table} ${where} ${orderClause} LIMIT ${limit}`,
            args,
        });
        res.json({ data: result.rows, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// GET /api/:table/:id
app.get('/api/:table/:id', auth, async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const result = await db.execute({
            sql:  `SELECT * FROM ${table} WHERE id = :id LIMIT 1`,
            args: { id: req.params.id },
        });
        const row = result.rows[0] || null;
        res.json({ data: row, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// POST /api/:table
app.post('/api/:table', auth, async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const body = { id: uuid(), ...req.body };
        const cols = Object.keys(body).join(', ');
        const keys = Object.keys(body).map(k => `:${k}`).join(', ');
        await db.execute({ sql: `INSERT INTO ${table} (${cols}) VALUES (${keys})`, args: body });
        res.json({ data: body, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// PUT /api/:table/:id
app.put('/api/:table/:id', auth, async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const updates = Object.entries(req.body)
            .map(([k]) => `${k} = :${k}`).join(', ');
        await db.execute({
            sql:  `UPDATE ${table} SET ${updates} WHERE id = :_id`,
            args: { ...req.body, _id: req.params.id },
        });
        res.json({ data: { id: req.params.id, ...req.body }, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// DELETE /api/:table/:id
app.delete('/api/:table/:id', auth, async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        await db.execute({
            sql:  `DELETE FROM ${table} WHERE id = :id`,
            args: { id: req.params.id },
        });
        res.json({ data: { id: req.params.id }, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// ── JOIN queries endpoint ─────────────────────────────────────
// POST /api/query — esegue query SQL custom (solo SELECT)
app.post('/api/query', auth, async (req, res) => {
    const { sql, args = {} } = req.body;
    if (!sql || !sql.trim().toUpperCase().startsWith('SELECT')) {
        return res.status(403).json({ error: 'Solo query SELECT consentite' });
    }
    try {
        const result = await db.execute({ sql, args });
        res.json({ data: result.rows, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// ── AUTH endpoints ────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.execute({
            sql:  'SELECT * FROM users WHERE username = :username LIMIT 1',
            args: { username },
        });
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

        const token = signToken({ id: user.id, username: user.username, role: user.role, society_id: user.society_id });
        res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, society_id: user.society_id } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', auth, (req, res) => {
    // JWT è stateless — il client semplicemente cancella il token
    res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql:  'SELECT id, username, name, email, role, society_id FROM users WHERE id = :id',
            args: { id: req.user.id },
        });
        res.json({ user: result.rows[0] || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/create-user (solo admin)
app.post('/api/auth/create-user', auth, async (req, res) => {
    if (!['admin','manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Permesso negato' });
    }
    const { username, password, name, email, role, society_id } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const id   = uuid();
        await db.execute({
            sql:  'INSERT INTO users (id, username, name, email, password_hash, role, society_id) VALUES (:id,:username,:name,:email,:hash,:role,:society_id)',
            args: { id, username, name, email, hash, role, society_id },
        });
        res.json({ data: { id, username, name, email, role, society_id }, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

app.listen(PORT, () => console.log(`SportTrackPro API → http://localhost:${PORT}`));
