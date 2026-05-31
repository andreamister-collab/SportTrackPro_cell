// ============================================================
// SportTrackPro — Turso Client Adapter
// Sostituisce il Supabase client SDK con un'interfaccia
// identica basata su fetch → API server Turso
//
// In index.html sostituire:
//   import { client } from './db.js';
// con:
//   import { client } from './turso_client.js';
// ============================================================

const API_BASE = window.SPORTTRACK_API_URL || 'http://localhost:3001/api';

// ── Token storage ─────────────────────────────────────────────
const tokenKey = 'stp_token';
const getToken = ()     => localStorage.getItem(tokenKey);
const setToken = (t)    => localStorage.setItem(tokenKey, t);
const delToken = ()     => localStorage.removeItem(tokenKey);

// ── Base fetch ────────────────────────────────────────────────
const apiFetch = async (path, opts = {}) => {
    const token = getToken();
    const res = await fetch(API_BASE + path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
};

// ── Query builder — mirrors Supabase chained API ──────────────
class QueryBuilder {
    constructor(table) {
        this._table   = table;
        this._filters = {};
        this._order   = '';
        this._limit   = 1000;
        this._single  = false;
        this._select  = '*';
        this._method  = 'GET';
        this._body    = null;
        this._id      = null;
        this._isRPC   = false;
        this._sql     = null;
        this._args    = {};
    }

    // ── SELECT columns (ignored in simple adapter — server returns *) ──
    select(cols) { this._select = cols; return this; }

    // ── Filters ───────────────────────────────────────────────
    eq(col, val)   { this._filters[col] = val;  return this; }
    neq(col, val)  { this._filters[`${col}__neq`] = val; return this; } // handled server-side
    is(col, val)   { this._filters[col] = val;  return this; }
    in(col, vals)  { this._filters[col] = vals; return this; }
    gt(col, val)   { this._filters[`${col}__gt`]  = val; return this; }
    gte(col, val)  { this._filters[`${col}__gte`] = val; return this; }
    lt(col, val)   { this._filters[`${col}__lt`]  = val; return this; }
    lte(col, val)  { this._filters[`${col}__lte`] = val; return this; }
    ilike(col, val){ this._filters[`${col}__ilike`] = val; return this; }

    // ── Ordering / limiting ───────────────────────────────────
    order(col, opts = {}) {
        this._order = `${col} ${opts.ascending === false ? 'DESC' : 'ASC'}`;
        return this;
    }
    limit(n)   { this._limit  = n;    return this; }
    single()   { this._single = true; return this; }

    // ── Mutations ─────────────────────────────────────────────
    insert(data)       { this._method = 'POST';   this._body = Array.isArray(data) ? data[0] : data; return this; }
    update(data)       { this._method = 'PUT';    this._body = data; return this; }
    delete()           { this._method = 'DELETE'; return this; }
    upsert(data, opts) { this._method = 'POST';   this._body = Array.isArray(data) ? data[0] : data; return this; }

    // ── Custom SQL (used for JOINs) ────────────────────────────
    _rawSQL(sql, args) { this._sql = sql; this._args = args; return this; }

    // ── Execute ───────────────────────────────────────────────
    async _execute() {
        // Custom SQL
        if (this._sql) {
            const res = await apiFetch('/query', { method: 'POST', body: { sql: this._sql, args: this._args } });
            return { data: res.data || [], error: res.error || null };
        }

        const table = this._table;

        if (this._method === 'POST') {
            const res = await apiFetch(`/${table}`, { method: 'POST', body: this._body });
            if (this._single) return { data: res.data, error: res.error };
            return { data: [res.data], error: res.error };
        }

        if (this._method === 'PUT') {
            if (!this._id) {
                // Need to find the id first from filters
                const findRes = await apiFetch(`/${table}?filters=${encodeURIComponent(JSON.stringify(this._filters))}&limit=1`);
                const row = findRes.data?.[0];
                if (!row) return { data: null, error: 'Row not found' };
                this._id = row.id;
            }
            const res = await apiFetch(`/${table}/${this._id}`, { method: 'PUT', body: this._body });
            return { data: res.data, error: res.error };
        }

        if (this._method === 'DELETE') {
            if (this._id) {
                const res = await apiFetch(`/${table}/${this._id}`, { method: 'DELETE' });
                return { data: res.data, error: res.error };
            }
            // Delete by filter: find rows first
            const findRes = await apiFetch(`/${table}?filters=${encodeURIComponent(JSON.stringify(this._filters))}`);
            const rows = findRes.data || [];
            for (const row of rows) {
                await apiFetch(`/${table}/${row.id}`, { method: 'DELETE' });
            }
            return { data: rows, error: null };
        }

        // GET
        if (this._id) {
            const res = await apiFetch(`/${table}/${this._id}`);
            return { data: res.data, error: res.error };
        }

        const params = new URLSearchParams();
        if (Object.keys(this._filters).length) params.set('filters', JSON.stringify(this._filters));
        if (this._order) params.set('order', this._order);
        if (this._limit !== 1000) params.set('limit', this._limit);

        const res = await apiFetch(`/${table}?${params}`);
        const data = res.data || [];

        if (this._single) return { data: data[0] || null, error: res.error };
        return { data, error: res.error };
    }

    // Allow awaiting the builder directly
    then(resolve, reject) { return this._execute().then(resolve, reject); }

    // Supabase-style .select() after mutation to get result
    select(cols) { this._select = cols; return this; }
}

// Helper for .eq() chains that need to set an ID
QueryBuilder.prototype._setId = function(id) { this._id = id; return this; };

// ── Auth module ───────────────────────────────────────────────
const auth = {
    async getSession() {
        const token = getToken();
        if (!token) return { data: { session: null } };
        try {
            const res = await apiFetch('/auth/me');
            if (res.user) return { data: { session: { user: res.user } } };
        } catch {}
        return { data: { session: null } };
    },

    async signInWithPassword({ email, password }) {
        // username login — email field used as username for compatibility
        const res = await apiFetch('/auth/login', {
            method: 'POST',
            body: { username: email, password },
        });
        if (res.token) {
            setToken(res.token);
            return { data: { session: { user: res.user } }, error: null };
        }
        return { data: null, error: { message: res.error || 'Login fallito' } };
    },

    async signOut() {
        delToken();
        return { error: null };
    },

    admin: {
        async createUser({ email, password, email_confirm }) {
            const res = await apiFetch('/auth/create-user', {
                method: 'POST',
                body: { username: email, password, email },
            });
            return { data: res.data ? { user: res.data } : null, error: res.error ? { message: res.error } : null };
        }
    },

    async signUp({ email, password }) {
        return auth.admin.createUser({ email, password });
    }
};

// ── Main client object ────────────────────────────────────────
export const client = {
    auth,
    from(table) {
        return new QueryBuilder(table);
    },
};

// ── Expose API URL setter ─────────────────────────────────────
export const setApiUrl = (url) => { window.SPORTTRACK_API_URL = url; };
