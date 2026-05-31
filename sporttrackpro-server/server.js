#!/usr/bin/env node
// ============================================================
// SportTrackPro — API Server Completo per Turso
// Versione con TUTTI gli endpoint: dati + auth + password
//
// Install: npm install
// Sviluppo: npm run dev
// Produzione: npm start
// ============================================================

import express    from 'express';
import { createClient } from '@libsql/client';
import bcrypt     from 'bcryptjs';
import jwt        from 'jsonwebtoken';
import cors       from 'cors';
import path       from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json());

// Log ogni richiesta (togli in produzione se vuoi meno rumore)
app.use((req, _, next) => {
    console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}`);
    next();
});

// ── Frontend statico ───────────────────────────────────────────
// Serve index.html e turso_client.js dalla cartella padre
const FRONTEND_DIR = path.resolve(__dirname, '..');
app.use(express.static(FRONTEND_DIR));
app.get('/', (_, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ── Turso client ───────────────────────────────────────────────
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error('❌ Mancano TURSO_DATABASE_URL o TURSO_AUTH_TOKEN nel file .env');
    process.exit(1);
}

const db = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Test connessione all'avvio
try {
    await db.execute('SELECT 1');
    console.log('✅ Turso connesso:', process.env.TURSO_DATABASE_URL);
} catch (e) {
    console.error('❌ Turso non raggiungibile:', e.message);
    process.exit(1);
}

// Auto-migrate: aggiungi colonne mancanti se non esistono
// ── Column cache — avoids inserting non-existent columns ───────
const _colCache = {};
const getTableCols = async (table) => {
    if (_colCache[table]) return _colCache[table];
    try {
        const r = await db.execute(`PRAGMA table_info(${table})`);
        _colCache[table] = new Set(r.rows.map(row => row.name));
    } catch {
        _colCache[table] = null; // unknown table
    }
    return _colCache[table];
};

// Filter an object to only include columns that exist in the table
const filterCols = async (table, obj) => {
    const cols = await getTableCols(table);
    if (!cols) return obj; // unknown table — pass through
    const filtered = {};
    Object.keys(obj).forEach(k => { if (cols.has(k)) filtered[k] = obj[k]; });
    return filtered;
};

const autoMigrate = async () => {
    const migrations = [
        "ALTER TABLE users    ADD COLUMN management_role TEXT",
        "ALTER TABLE users    ADD COLUMN password_hash   TEXT",
        "ALTER TABLE users    ADD COLUMN name            TEXT",
        "ALTER TABLE users    ADD COLUMN email           TEXT",
        "ALTER TABLE athletes ADD COLUMN medical_expiry  TEXT",
        "ALTER TABLE seasons  ADD COLUMN sport_id        TEXT",
        "ALTER TABLE seasons  ADD COLUMN society_id      TEXT",
        "ALTER TABLE sessions ADD COLUMN category_id     TEXT",
        "ALTER TABLE teams    ADD COLUMN sport_id        TEXT",
        "ALTER TABLE teams    ADD COLUMN season_id       TEXT",
    ];
    for (const sql of migrations) {
        try { await db.execute(sql); console.log('✅ Migration:', sql.slice(0,50)); }
        catch(e) { /* colonna già esistente — ignorato */ }
    }
    // Clear column cache so new columns are picked up
    Object.keys(_colCache).forEach(k => delete _colCache[k]);
};
await autoMigrate();

// ── JWT helpers ────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET nel .env deve essere almeno 32 caratteri');
    process.exit(1);
}

const signToken = (payload) =>
    jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' });

// ── Auth middleware ────────────────────────────────────────────
const auth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non autenticato' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token non valido o scaduto' });
    }
};

// Solo admin/manager
const adminOnly = (req, res, next) => {
    if (!['admin','manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Permesso negato — solo admin' });
    }
    next();
};

// ── UUID generator ─────────────────────────────────────────────
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});



// ── Tabelle consentite (whitelist sicurezza) ───────────────────
const ALLOWED_TABLES = new Set([
    'sports','societies','seasons','categories','teams','session_types',
    'athletes','athlete_team_seasons','parent_athletes',
    'sessions','attendances','match_details','match_stats',
    'test_definitions','test_performances','test_sessions',
    'test_attendances','test_results',
    'tournaments','tournament_phases','tournament_groups',
    'tournament_group_teams','tournament_matches','tournament_phase_matches',
    'users','user_category_seasons','individual_test_definitions',
'individual_test_performances',
'individual_test_sessions',
'individual_test_results',
]);

// ── Query builder semplice ─────────────────────────────────────
const buildWhere = (filters = {}) => {
    const clauses = [], args = {};

    // Convert col name to safe SQLite param name (no dots, no special chars)
    const safe = (s) => s.replace(/[^a-zA-Z0-9]/g, '_');

    Object.entries(filters).forEach(([col, val]) => {
        if (val === undefined || val === null) return;

        // Detect modifier suffix: __gte, __lte, __gt, __lt, __neq, __ilike, __not_null, __not_in
        const modMatch = col.match(/^(.+?)(__(?:gte|lte|gt|lt|neq|ilike|not_null|not_in))$/);
        const colName  = modMatch ? modMatch[1] : col;  // SQL column (may have dots)
        const mod      = modMatch ? modMatch[2] : null;
        const safeKey  = safe(colName);                  // safe param name (no dots)

        if (Array.isArray(val)) {
            const keys = val.map((_, i) => `:${safeKey}_${i}`);
            val.forEach((v, i) => { args[`${safeKey}_${i}`] = v; });
            if (mod === '__not_in') {
                clauses.push(`${colName} NOT IN (${keys.join(',')})`);
            } else {
                clauses.push(`${colName} IN (${keys.join(',')})`);
            }
        } else if (mod === '__gte') {
            clauses.push(`${colName} >= :${safeKey}_gte`);
            args[`${safeKey}_gte`] = val;
        } else if (mod === '__lte') {
            clauses.push(`${colName} <= :${safeKey}_lte`);
            args[`${safeKey}_lte`] = val;
        } else if (mod === '__gt') {
            clauses.push(`${colName} > :${safeKey}_gt`);
            args[`${safeKey}_gt`] = val;
        } else if (mod === '__lt') {
            clauses.push(`${colName} < :${safeKey}_lt`);
            args[`${safeKey}_lt`] = val;
        } else if (mod === '__neq') {
            clauses.push(`${colName} != :${safeKey}_neq`);
            args[`${safeKey}_neq`] = val;
        } else if (mod === '__ilike') {
            clauses.push(`${colName} LIKE :${safeKey}_like`);
            args[`${safeKey}_like`] = String(val).replace(/%/g,'') + '%';
        } else if (mod === '__not_null') {
            clauses.push(`${colName} IS NOT NULL`);
        } else {
            // Plain equality (with or without table prefix)
            clauses.push(`${colName} = :${safeKey}`);
            args[safeKey] = val;
        }
    });
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args };
};

// ═══════════════════════════════════════════════════════════════
//  ENDPOINT AUTENTICAZIONE
// ═══════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Username e password obbligatori' });

    try {
        // Try exact match first, then case-insensitive
        let result = await db.execute({
            sql:  'SELECT * FROM users WHERE username = :username LIMIT 1',
            args: { username: username.toLowerCase().trim() },
        });
        // If not found, try original case
        if (!result.rows[0]) {
            result = await db.execute({
                sql:  'SELECT * FROM users WHERE LOWER(username) = :username LIMIT 1',
                args: { username: username.toLowerCase().trim() },
            });
        }
        const user = result.rows[0];

        if (!user) {
            // List available usernames for debugging (remove in production)
            const allUsers = await db.execute('SELECT username, role FROM users LIMIT 10');
            console.log('Login failed - username not found:', username);
            console.log('Available users:', allUsers.rows.map(u => u.username));
            return res.status(401).json({ 
                error: 'Username non trovato',
                debug_hint: 'Controlla i log del server per vedere gli utenti disponibili'
            });
        }

        if (!user.password_hash) {
            console.log('Login failed - user has no password_hash:', username);
            return res.status(401).json({ error: 'Password non impostata per questo utente' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            console.log('Login failed - wrong password for:', username);
            return res.status(401).json({ error: 'Password errata' });
        }

        // Genera token — non include password_hash
        const token = signToken({
            id:         user.id,
            username:   user.username,
            role:       user.role,
            society_id: user.society_id,
        });

        // Risposta senza password_hash
        const { password_hash, ...safeUser } = user;
        res.json({ token, user: safeUser, error: null });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/auth/me  — chi sono io (dal token)
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql:  'SELECT * FROM users WHERE id = :id',
            args: { id: req.user.id },
        });
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        // Remove password_hash from response
        const { password_hash: _ph, ...safeUser } = user;
        res.json({ user: safeUser, error: null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/logout — il client cancella il token, qui logghiamo solo
app.post('/api/auth/logout', auth, (req, res) => {
    res.json({ success: true });
});

// POST /api/auth/change-password — ogni utente cambia la propria
app.post('/api/auth/change-password', auth, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!new_password || new_password.length < 8)
        return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });

    try {
        const result = await db.execute({
            sql:  'SELECT password_hash FROM users WHERE id = :id',
            args: { id: req.user.id },
        });
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });

        const valid = await bcrypt.compare(current_password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Password attuale non corretta' });

        const hash = await bcrypt.hash(new_password, 12);
        await db.execute({
            sql:  'UPDATE users SET password_hash = :hash WHERE id = :id',
            args: { hash, id: req.user.id },
        });

        res.json({ success: true, message: 'Password aggiornata' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/reset-password — solo admin reimposta password altrui
app.post('/api/auth/reset-password', auth, adminOnly, async (req, res) => {
    const { user_id, new_password } = req.body;
    if (!user_id || !new_password || new_password.length < 8)
        return res.status(400).json({ error: 'user_id e password (min 8 caratteri) obbligatori' });

    try {
        const hash = await bcrypt.hash(new_password, 12);
        await db.execute({
            sql:  'UPDATE users SET password_hash = :hash WHERE id = :id',
            args: { hash, id: user_id },
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/create-user — admin crea un nuovo utente
app.post('/api/auth/create-user', auth, adminOnly, async (req, res) => {
    const { username, password, name, email, role, management_role, society_id } = req.body;
    // Normalise role: 'user' and 'genitore' both become 'genitore' in our system
    const normRole = (role === 'user' ? 'genitore' : role) || 'allenatore';

    if (!username || !password || !name)
        return res.status(400).json({ error: 'username, password e name obbligatori' });
    if (password.length < 8)
        return res.status(400).json({ error: 'Password minimo 8 caratteri' });

    try {
        // Controlla duplicato username
        const dup = await db.execute({
            sql: 'SELECT id FROM users WHERE username = :u LIMIT 1',
            args: { u: username.toLowerCase().trim() },
        });
        if (dup.rows.length > 0)
            return res.status(409).json({ error: `Username "${username}" già in uso` });

        const hash = await bcrypt.hash(password, 12);
        const id   = uuid();

        // Build insert dynamically to handle optional columns (es. management_role)
        const insertData = {
            id,
            username:      username.toLowerCase().trim(),
            name:          name.trim(),
            email:         email || null,
            password_hash: hash,
            role:          role || 'allenatore',
            society_id:    society_id || null,
        };
        if (management_role !== undefined) insertData.management_role = management_role || null;

        const insertCols = Object.keys(insertData).join(', ');
        const insertVals = Object.keys(insertData).map(k => ':' + k).join(', ');

        await db.execute({
            sql:  `INSERT INTO users (${insertCols}) VALUES (${insertVals})`,
            args: insertData,
        });

        const { password_hash: _ph, ...safeNew } = insertData;
        res.json({ data: safeNew, error: null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  ENDPOINT DATI GENERICI  GET/POST/PUT/DELETE /api/:table
// ═══════════════════════════════════════════════════════════════

// ── Helper: build JOIN query for dot-notation filters ──────────
// e.g. sessions.season_id, sessions.team_id on attendances/match_stats/match_details
const JOIN_TABLES = {
    // main_table → { join_table → join_on }
    attendances:    {
        sessions:         'attendances.session_id = sessions.id',
        athletes:         'attendances.athlete_id = athletes.id',
    },
    match_stats:    {
        sessions:         'match_stats.session_id = sessions.id',
        athletes:         'match_stats.athlete_id = athletes.id',
    },
    match_details:  {
        sessions:         'match_details.session_id = sessions.id',
    },
    test_sessions:  {
        test_definitions: 'test_sessions.test_def_id = test_definitions.id',
    },
    test_results:   {
        test_performances:'test_results.performance_id = test_performances.id',
    },
    athlete_team_seasons: {
        athletes:         'athlete_team_seasons.athlete_id = athletes.id',
        teams:            'athlete_team_seasons.team_id = teams.id',
        categories:       'athlete_team_seasons.category_id = categories.id',
        seasons:          'athlete_team_seasons.season_id = seasons.id',
        societies:        'athlete_team_seasons.society_id = societies.id',
    },
};

const buildJoinQuery = (table, filters, order, limit) => {
    // Separate dot filters from plain filters
    const dotFilters  = {};
    const plainFilters = {};
    
    Object.entries(filters).forEach(([k, v]) => {
        if (k.includes('.')) dotFilters[k] = v;
        else plainFilters[k] = v;
    });
    
    if (!Object.keys(dotFilters).length) return null; // no join needed

    // Determine which tables to join
    const joinDefs = JOIN_TABLES[table] || {};
    const joins = [];
    const neededTables = new Set(Object.keys(dotFilters).map(k => k.split('.')[0]));
    
    neededTables.forEach(jt => {
        if (joinDefs[jt]) {
            // joinDefs[jt] is either a string (join condition) or {on: '...'}
            const on = typeof joinDefs[jt] === 'string' ? joinDefs[jt] : joinDefs[jt].on;
            joins.push(`JOIN ${jt} ON ${on}`);
        } else {
            // Fallback: guess FK name (remove trailing 's', add _id)
            const fkGuess = jt.replace(/ies$/, 'y').replace(/s$/, '') + '_id';
            joins.push(`JOIN ${jt} ON ${table}.${fkGuess} = ${jt}.id`);
        }
    });
    
    // Build WHERE from all filters
    const allFilters = {};
    // Plain filters — prefix with table name to avoid ambiguity in JOINs
    Object.entries(plainFilters).forEach(([k, v]) => {
        const baseKey = k.replace(/__(?:neq|gt|gte|lt|lte|ilike|not_null|not_in)$/, '');
        const modifier = k.slice(baseKey.length);
        // Only prefix bare column names (no dots, no existing table prefix)
        if (!baseKey.includes('.')) {
            allFilters[`${table}.${baseKey}${modifier}`] = v;
        } else {
            allFilters[k] = v;
        }
    });
    // Dot filters stay as-is (already qualified)
    Object.assign(allFilters, dotFilters);
    
    const { sql: where, args } = buildWhere(allFilters);
    const safeOrd1 = order.replace(/[^a-zA-Z0-9_,. ]/g, '');
    const orderSQL = safeOrd1 ? `ORDER BY ${safeOrd1}` : '';
    
    const sql = `SELECT ${table}.* FROM ${table} ${joins.join(' ')} ${where} ${orderSQL} LIMIT ${limit}`;
    return { sql, args };
};

// GET /api/:table
app.get('/api/:table', auth, async (req, res) => {
    const { table } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const order   = req.query.order || '';
        const limit   = Math.min(parseInt(req.query.limit) || 1000, 5000);

        // Normalize boolean values (false/true → 0/1 for SQLite)
        Object.keys(filters).forEach(k => {
            if (filters[k] === false) filters[k] = 0;
            if (filters[k] === true)  filters[k] = 1;
        });

        // Check if we need a JOIN query (dot-notation filters like sessions.season_id)
        const joinQuery = buildJoinQuery(table, filters, order, limit);
        
        let result;
        if (joinQuery) {
            result = await db.execute({ sql: joinQuery.sql, args: joinQuery.args });
        } else {
            const { sql: where, args } = buildWhere(filters);
            const safeOrd2 = order.replace(/[^a-zA-Z0-9_,. ]/g, '');
            const orderSQL = safeOrd2 ? `ORDER BY ${safeOrd2}` : '';
            result = await db.execute({
                sql:  `SELECT * FROM ${table} ${where} ${orderSQL} LIMIT ${limit}`,
                args,
            });
        }
        res.json({ data: result.rows, error: null });
    } catch (e) {
        console.error('GET /' + table + ' error:', e.message);
        res.status(400).json({ data: null, error: e.message });
    }
});

// GET /api/:table/:id
app.get('/api/:table/:id', auth, async (req, res) => {
    const { table, id } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const result = await db.execute({
            sql:  `SELECT * FROM ${table} WHERE id = :id LIMIT 1`,
            args: { id },
        });
        res.json({ data: result.rows[0] || null, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// POST /api/:table  — insert
app.post('/api/:table', auth, async (req, res) => {
    const { table } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    // Per insert in users senza password: imposta hash placeholder (richiederà reset)
    if (table === 'users' && !req.body.password_hash && !req.body.password) {
        // Placeholder non-valido — l'utente dovrà fare reset password prima di accedere
        req.body.password_hash = '$2b$10$PLACEHOLDER_RESET_REQUIRED_xxxxxxxxxxxxxxxxxxxxxxxx';
    }
    // Blocca inserimento password in chiaro
    if (table === 'users' && req.body.password && !req.body.password_hash) {
        return res.status(403).json({ error: 'Usa /api/auth/create-user per creare utenti con password' });
    }

    try {
        const rawBody = { id: uuid(), ...req.body };
        // Filter to only columns that actually exist in the table
        const body = await filterCols(table, rawBody);
        const cols = Object.keys(body);
        if (!cols.length) return res.status(400).json({ data: null, error: 'Nessuna colonna valida' });
        const placeholders = cols.map(k => `:${k}`).join(', ');
        await db.execute({
            sql:  `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
            args: body,
        });
        res.json({ data: rawBody, error: null }); // return full body including unknown cols (client may need them)
    } catch (e) {
        console.error(`POST /${table} error:`, e.message);
        res.status(400).json({ data: null, error: e.message });
    }
});

// POST /api/:table/upsert  — upsert with conflict resolution
app.post('/api/:table/upsert', auth, async (req, res) => {
    const { table } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });
    if (table === 'users' && req.body.rows?.some(r => r.password && !r.password_hash))
        return res.status(403).json({ error: 'Usa /api/auth/create-user per creare utenti con password' });

    try {
        const rows       = req.body.rows || [req.body];
        const onConflict = req.body.onConflict || 'id';
        const conflictCols = onConflict.split(',').map(c => c.trim());
        const results = [];

        for (let rawRow of rows) {
            // Normalize booleans
            const row = {};
            Object.keys(rawRow).forEach(k => {
                row[k] = rawRow[k] === true ? 1 : rawRow[k] === false ? 0 : rawRow[k];
            });

            // Filter to existing columns
            const filtered = await filterCols(table, row);

            // Build WHERE from conflict columns
            const conflictFilters = {};
            conflictCols.forEach(c => { if (filtered[c] != null) conflictFilters[c] = filtered[c]; });

            if (Object.keys(conflictFilters).length === conflictCols.length) {
                // Check if exists
                const { sql: wh, args: wa } = buildWhere(conflictFilters);
                const existing = await db.execute({ sql: `SELECT id FROM ${table} ${wh} LIMIT 1`, args: wa });

                if (existing.rows.length > 0) {
                    // UPDATE
                    const existingId = existing.rows[0].id;
                    const fields = Object.keys(filtered).filter(k => k !== 'id');
                    if (fields.length) {
                        const sets = fields.map(k => `${k} = :${k}`).join(', ');
                        await db.execute({ sql: `UPDATE ${table} SET ${sets} WHERE id = :_id`, args: { ...filtered, _id: existingId } });
                    }
                    results.push({ ...filtered, id: existingId });
                    continue;
                }
            }

            // INSERT
            if (!filtered.id) filtered.id = uuid();
            const cols = Object.keys(filtered);
            const placeholders = cols.map(k => `:${k}`).join(', ');
            await db.execute({ sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, args: filtered });
            results.push(filtered);
        }

        res.json({ data: results.length === 1 ? results[0] : results, error: null });
    } catch (e) {
        console.error(`UPSERT /${table} error:`, e.message);
        res.status(400).json({ data: null, error: e.message });
    }
});

// PUT /api/:table/:id  — update
app.put('/api/:table/:id', auth, async (req, res) => {
    const { table, id } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    // Blocca aggiornamento diretto di password_hash (deve passare per change-password)
    if (table === 'users' && req.body.password_hash)
        return res.status(403).json({ error: 'Usa /api/auth/change-password per cambiare la password' });

    try {
        // Filter to only columns that actually exist in the table
        const filtered = await filterCols(table, req.body);
        const fields = Object.keys(filtered);
        if (!fields.length) return res.json({ data: { id, ...req.body }, error: null }); // nothing to update
        const sets = fields.map(k => `${k} = :${k}`).join(', ');
        await db.execute({
            sql:  `UPDATE ${table} SET ${sets} WHERE id = :_id`,
            args: { ...filtered, _id: id },
        });
        res.json({ data: { id, ...req.body }, error: null });
    } catch (e) {
        console.error(`PUT /${table}/${id} error:`, e.message);
        res.status(400).json({ data: null, error: e.message });
    }
});

// DELETE /api/:table/:id
app.delete('/api/:table/:id', auth, async (req, res) => {
    const { table, id } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        await db.execute({ sql: `DELETE FROM ${table} WHERE id = :id`, args: { id } });
        res.json({ data: { id }, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// DELETE /api/:table  — delete con filtri (es. delete().eq('athlete_id', x))
app.delete('/api/:table', auth, async (req, res) => {
    const { table } = req.params;
    if (!ALLOWED_TABLES.has(table))
        return res.status(403).json({ error: 'Tabella non consentita' });

    try {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        if (!Object.keys(filters).length)
            return res.status(400).json({ error: 'Filtro obbligatorio per delete senza id' });

        const { sql: where, args } = buildWhere(filters);
        await db.execute({ sql: `DELETE FROM ${table} ${where}`, args });
        res.json({ data: null, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  ENDPOINT QUERY SQL (JOIN complessi)
// ═══════════════════════════════════════════════════════════════

// POST /api/query  — esegue SELECT personalizzate
app.post('/api/query', auth, async (req, res) => {
    const { sql, args = {} } = req.body;
    if (!sql || !sql.trim().toUpperCase().startsWith('SELECT'))
        return res.status(403).json({ error: 'Solo query SELECT consentite' });

    try {
        const result = await db.execute({ sql, args });
        res.json({ data: result.rows, error: null });
    } catch (e) {
        res.status(400).json({ data: null, error: e.message });
    }
});

// ── Health check ───────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── DEBUG: list users (NO auth — REMOVE after setup) ───────────
app.get('/debug/users', async (_, res) => {
    try {
        const r = await db.execute('SELECT id, username, name, role, society_id FROM users LIMIT 20');
        res.json({ users: r.rows, count: r.rows.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DEBUG: check schema ─────────────────────────────────────────
app.get('/debug/schema', async (_, res) => {
    try {
        const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        const userCols = await db.execute("PRAGMA table_info(users)");
        res.json({ tables: tables.rows.map(r=>r.name), user_columns: userCols.rows.map(r=>r.name) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 404 catch-all ──────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Endpoint non trovato: ${req.method} ${req.path}` }));

// ── Avvio ──────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 SportTrackPro API    → http://localhost:${PORT}/api`);
    console.log(`   Health              → http://localhost:${PORT}/health`);
});

// ── Frontend su porta 3000 ─────────────────────────────────────
const FRONTEND_PORT = process.env.FRONTEND_PORT || 3000;
app.listen(FRONTEND_PORT, () => {
    console.log(`   Frontend            → http://localhost:${FRONTEND_PORT}\n`);
});
