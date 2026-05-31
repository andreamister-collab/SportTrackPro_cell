// ============================================================
// SportTrackPro — Turso Client v2 (Browser, con risoluzione relazioni)
// Gestisce select con relazioni annidate tipo PostgREST:
//   .select('id, name, societies(name)')
//   .select('*, sessions!inner(session_date, team_id)')
// ============================================================

(function() {

const API_BASE = () => window.SPORTTRACK_API_URL || 'http://localhost:3001/api';
const tokenKey = 'stp_token';
const getToken = ()  => localStorage.getItem(tokenKey);
const setToken = (t) => localStorage.setItem(tokenKey, t);
const delToken = ()  => localStorage.removeItem(tokenKey);

// ── Base fetch ────────────────────────────────────────────────
const apiFetch = async (path, opts = {}) => {
    const token = getToken();
    const res = await fetch(API_BASE() + path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok && res.status !== 400) {
        const text = await res.text();
        throw new Error('API ' + res.status + ': ' + text.slice(0, 200));
    }
    return res.json();
};

// ── Relation parser ───────────────────────────────────────────
// Parses "id, name, societies(name), teams!inner(id, name, categories(name))"
// Returns { baseCols: ['id','name'], relations: [{alias:'societies', table:'societies', cols:['name'], children:[...]}] }
const parseSelect = (selectStr) => {
    if (!selectStr || selectStr === '*') return { baseCols: ['*'], relations: [] };
    
    const relations = [];
    const baseCols  = [];
    
    // Remove inner/fk hints: "sessions!inner" → "sessions", "athletes!fk_xxx" → "athletes"
    const clean = selectStr.replace(/![\w]+/g, '');
    
    let depth = 0, token = '', i = 0;
    const tokens = [];
    
    while (i < clean.length) {
        const c = clean[i];
        if (c === '(') { depth++; token += c; }
        else if (c === ')') { depth--; token += c; if (depth === 0) { tokens.push(token.trim()); token = ''; } }
        else if (c === ',' && depth === 0) { if (token.trim()) tokens.push(token.trim()); token = ''; }
        else { token += c; }
        i++;
    }
    if (token.trim()) tokens.push(token.trim());
    
    for (const t of tokens) {
        // Match "tablename(cols)" OR "tablename (cols)" (with optional space)
        // Also handle "alias:table(cols)" format
        const rel = t.match(/^(\w+)\s*\((.+)\)$/s);
        if (rel) {
            const [, relTable, relCols] = rel;
            const sub = parseSelect(relCols);
            relations.push({ alias: relTable, table: relTable, cols: sub.baseCols, relations: sub.relations });
        } else if (t.trim()) {
            baseCols.push(t.trim());
        }
    }
    
    return { baseCols, relations };
};

// ── Resolve relations (fetch related rows and merge) ──────────
// Knows which column in the main table references which table
const FK_MAP = {
    // table → { relation_alias → { fk, pk, table } }
    categories:          { societies:            { fk:'society_id',    pk:'id', table:'societies'           } },
    societies:           { sports:               { fk:'sport_id',      pk:'id', table:'sports'              } },
    teams:               { categories:           { fk:'category_id',   pk:'id', table:'categories'          },
                           societies:            { fk:'society_id',    pk:'id', table:'societies'           },
                           seasons:              { fk:'season_id',     pk:'id', table:'seasons'             },
                           sports:               { fk:'sport_id',      pk:'id', table:'sports'              } },
    sessions:            { session_types:        { fk:'type_id',       pk:'id', table:'session_types'       },
                           teams:                { fk:'team_id',       pk:'id', table:'teams'               },
                           societies:            { fk:'society_id',    pk:'id', table:'societies'           },
                           seasons:              { fk:'season_id',     pk:'id', table:'seasons'             },
                           categories:           { fk:'category_id',   pk:'id', table:'categories'         } },
    attendances:         { sessions:             { fk:'session_id',    pk:'id', table:'sessions'            },
                           athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    match_stats:         { sessions:             { fk:'session_id',    pk:'id', table:'sessions'            },
                           athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    match_details:       { sessions:             { fk:'session_id',    pk:'id', table:'sessions'            } },
    athlete_team_seasons:{ teams:                { fk:'team_id',       pk:'id', table:'teams'               },
                           categories:           { fk:'category_id',   pk:'id', table:'categories'          },
                           societies:            { fk:'society_id',    pk:'id', table:'societies'           },
                           seasons:              { fk:'season_id',     pk:'id', table:'seasons'             },
                           athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    user_category_seasons:{ teams:               { fk:'team_id',       pk:'id', table:'teams'               },
                            categories:          { fk:'category_id',   pk:'id', table:'categories'          },
                            societies:           { fk:'society_id',    pk:'id', table:'societies'           },
                            seasons:             { fk:'season_id',     pk:'id', table:'seasons'             },
                            users:               { fk:'user_id',       pk:'id', table:'users'               } },
    parent_athletes:     { athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    test_sessions:       { test_definitions:     { fk:'test_def_id',   pk:'id', table:'test_definitions'   },
                           teams:                { fk:'team_id',       pk:'id', table:'teams'               } },
    test_results:        { test_performances:    { fk:'performance_id',pk:'id', table:'test_performances'  },
                           athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    test_attendances:    { athletes:             { fk:'athlete_id',    pk:'id', table:'athletes'            },
                           teams:                { fk:'team_id',       pk:'id', table:'teams'               } },
    test_performances:   { test_definitions:     { fk:'test_def_id',   pk:'id', table:'test_definitions'   } },
    test_definitions:    { societies:            { fk:'society_id',    pk:'id', table:'societies'           },
                           teams:                { fk:'team_id',       pk:'id', table:'teams'               } },
    individual_test_definitions:  { societies:  { fk:'society_id',    pk:'id', table:'societies'           } },
    individual_test_performances: { individual_test_definitions: { fk:'def_id', pk:'id', table:'individual_test_definitions' } },
    individual_test_sessions:     { individual_test_definitions: { fk:'def_id', pk:'id', table:'individual_test_definitions' },
                                    athletes:   { fk:'athlete_id',    pk:'id', table:'athletes'            },
                                    teams:      { fk:'team_id',       pk:'id', table:'teams'               } },
    individual_test_results:      { individual_test_sessions:    { fk:'session_id',     pk:'id', table:'individual_test_sessions'    },
                                    individual_test_performances:{ fk:'performance_id', pk:'id', table:'individual_test_performances' },
                                    athletes:   { fk:'athlete_id',    pk:'id', table:'athletes'            } },
    tournament_groups:   { tournaments:          { fk:'tournament_id', pk:'id', table:'tournaments'         } },
    tournament_group_teams:{ tournament_groups:  { fk:'group_id',      pk:'id', table:'tournament_groups'  } },
    tournament_matches:  { tournament_groups:    { fk:'group_id',      pk:'id', table:'tournament_groups'  } },
    tournament_phases:   { tournaments:          { fk:'tournament_id', pk:'id', table:'tournaments'         } },
    tournament_phase_matches:{ tournament_phases:{ fk:'phase_id',      pk:'id', table:'tournament_phases'  } },
    tournaments:         { teams:                { fk:'team_id',       pk:'id', table:'teams'               },
                           societies:            { fk:'society_id',    pk:'id', table:'societies'           },
                           seasons:              { fk:'season_id',     pk:'id', table:'seasons'             } },
    athletes:            { societies:            { fk:'society_id',    pk:'id', table:'societies'           } },
};

// Resolve a set of relations for an array of rows
const resolveRelations = async (rows, relations, mainTable) => {
    if (!relations.length || !rows.length) return rows;
    
    const fkDefs = FK_MAP[mainTable] || {};
    
    for (const rel of relations) {
        const fkDef = fkDefs[rel.alias] || fkDefs[rel.table];
        if (!fkDef) continue;
        
        const { fk, pk, table } = fkDef;
        
        // Collect unique FK values
        const ids = [...new Set(rows.map(r => r[fk]).filter(Boolean))];
        if (!ids.length) {
            rows.forEach(r => { r[rel.alias] = null; });
            continue;
        }
        
        // Fetch related rows
        const qs = 'filters=' + encodeURIComponent(JSON.stringify({ [pk]: ids }));
        let relData;
        try {
            const res = await apiFetch('/' + table + '?' + qs + '&limit=5000');
            relData = res.data || [];
        } catch(e) {
            console.warn('Relation fetch failed:', table, e.message);
            relData = [];
        }
        
        // If related table also has relations, resolve recursively
        if (rel.relations && rel.relations.length) {
            relData = await resolveRelations(relData, rel.relations, table);
        }
        
        // Build lookup map
        const lookup = {};
        relData.forEach(r => { lookup[r[pk]] = r; });
        
        // Merge into main rows — only include requested cols
        rows.forEach(r => {
            const related = lookup[r[fk]] || null;
            if (!related) { r[rel.alias] = null; return; }
            
            if (rel.cols[0] === '*') {
                r[rel.alias] = related;
            } else {
                const subset = {};
                rel.cols.forEach(col => { if (col in related) subset[col] = related[col]; });
                // Include sub-relations
                rel.relations.forEach(sr => { if (sr.alias in related) subset[sr.alias] = related[sr.alias]; });
                r[rel.alias] = subset;
            }
        });
    }
    
    return rows;
};

// ── QueryBuilder ──────────────────────────────────────────────
function QueryBuilder(table) {
    this._table      = table;
    this._filters    = {};
    this._order      = '';
    this._limit      = 1000;
    this._single     = false;
    this._maybeSingle= false;
    this._method     = 'GET';
    this._body       = null;
    this._id         = null;
    this._selectStr  = '*';
    this._parsed     = null;
}

QueryBuilder.prototype.select = function(cols) { this._selectStr = cols || '*'; this._parsed = null; return this; };
QueryBuilder.prototype.eq    = function(c,v)  { this._filters[c]         = v;   if(c==='id')this._id=v; return this; };
QueryBuilder.prototype.neq   = function(c,v)  { this._filters[c+'__neq'] = v;   return this; };
QueryBuilder.prototype.is    = function(c,v)  { this._filters[c]         = v;   return this; };
QueryBuilder.prototype.in    = function(c,v)  { this._filters[c]         = v;   return this; };
QueryBuilder.prototype.gt    = function(c,v)  { this._filters[c+'__gt']  = v;   return this; };
QueryBuilder.prototype.gte   = function(c,v)  { this._filters[c+'__gte'] = v;   return this; };
QueryBuilder.prototype.lt    = function(c,v)  { this._filters[c+'__lt']  = v;   return this; };
QueryBuilder.prototype.lte   = function(c,v)  { this._filters[c+'__lte'] = v;   return this; };
QueryBuilder.prototype.ilike = function(c,v)  { this._filters[c+'__ilike']=v;   return this; };
QueryBuilder.prototype.not   = function(c,op,v) {
    if (op==='is'&&v===null) this._filters[c+'__not_null']=true;
    else if (op==='in')      this._filters[c+'__not_in']=v;
    else                     this._filters[c+'__neq']=v;
    return this;
};
QueryBuilder.prototype.or     = function()       { return this; };
QueryBuilder.prototype.filter = function(c,op,v) { this._filters[c+(op!=='eq'?'__'+op:'')] = v; return this; };
QueryBuilder.prototype.order  = function(c,opts) { this._order = c+' '+((opts||{}).ascending===false?'DESC':'ASC'); return this; };
QueryBuilder.prototype.limit  = function(n)      { this._limit = n;     return this; };
QueryBuilder.prototype.range  = function()       { return this; };
QueryBuilder.prototype.single     = function() { this._single=true;  this._maybeSingle=false; return this; };
QueryBuilder.prototype.maybeSingle= function() { this._single=true;  this._maybeSingle=true;  return this; };

QueryBuilder.prototype.insert = function(d) { this._method='POST';   this._body=Array.isArray(d)?d[0]:d; return this; };
QueryBuilder.prototype.update = function(d) { this._method='PUT';    this._body=d; return this; };
QueryBuilder.prototype.delete = function()  { this._method='DELETE'; return this; };
QueryBuilder.prototype.upsert = function(d, opts) {
    this._method    = 'UPSERT';
    this._upsertRows = Array.isArray(d) ? d : [d];
    this._onConflict = (opts && opts.onConflict) || 'id';
    return this;
};

QueryBuilder.prototype._execute = async function() {
    const table = this._table;
    
    // Normalize booleans for SQLite in any body being sent
    const normBool = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        const n = {};
        Object.keys(obj).forEach(k => {
            n[k] = obj[k] === true ? 1 : obj[k] === false ? 0 : obj[k];
        });
        return n;
    };

    if (this._method === 'UPSERT') {
        // Upsert: send to /api/:table/upsert with conflict columns
        const res = await apiFetch('/'+table+'/upsert', {
            method: 'POST',
            body: { rows: this._upsertRows.map(normBool), onConflict: this._onConflict }
        });
        return { data: res.data, error: res.error||null };
    }

    if (this._method === 'POST') {
        const res = await apiFetch('/'+table, { method:'POST', body:normBool(this._body) });
        if (this._single) return { data: res.data, error: res.error||null };
        return { data: res.data ? [res.data] : [], error: res.error||null };
    }
    if (this._method === 'PUT') {
        let id = this._id;
        if (!id) {
            const f = await apiFetch('/'+table+'?filters='+encodeURIComponent(JSON.stringify(this._filters))+'&limit=1');
            const r = f.data&&f.data[0]; if(!r) return { data:null, error:'Row not found' };
            id = r.id;
        }
        const res = await apiFetch('/'+table+'/'+id, { method:'PUT', body:this._body });
        return { data:res.data, error:res.error||null };
    }
    if (this._method === 'DELETE') {
        if (this._id) {
            const res = await apiFetch('/'+table+'/'+this._id, { method:'DELETE' });
            return { data:res.data, error:res.error||null };
        }
        const res = await apiFetch('/'+table+'?filters='+encodeURIComponent(JSON.stringify(this._filters)), { method:'DELETE' });
        return { data:res.data, error:res.error||null };
    }

    // GET — parse relations
    if (!this._parsed) this._parsed = parseSelect(this._selectStr);
    const { relations } = this._parsed;
    // Safety: if any baseCols look like "table (col)", re-parse with trimmed spaces
    // (already handled by regex fix above, but kept as safety net)
    
    // Build query params (strip relation syntax from server query)
    const params = new URLSearchParams();
    if (Object.keys(this._filters).length) params.set('filters', JSON.stringify(this._filters));
    if (this._order) params.set('order', this._order);
    params.set('limit', String(this._limit));
    
    // Single by ID shortcut
    if (this._id && Object.keys(this._filters).length===1 && this._filters['id']) {
        const res = await apiFetch('/'+table+'/'+this._id);
        let row = res.data ? [res.data] : [];
        if (relations.length) row = await resolveRelations(row, relations, table);
        if (this._single) return { data: row[0]||null, error:null };
        return { data: row, error:res.error||null };
    }
    
    const res = await apiFetch('/'+table+'?'+params.toString());
    let data = res.data || [];
    
    // Resolve nested relations
    if (relations.length && data.length) {
        data = await resolveRelations(data, relations, table);
    }
    
    if (this._single) return { data: data[0]||null, error:null };
    return { data, error:res.error||null };
};

QueryBuilder.prototype.then = function(resolve, reject) {
    return this._execute().then(resolve, reject);
};

// ── Auth ──────────────────────────────────────────────────────
var auth = {
    getSession: async function() {
        const token = getToken();
        if (!token) return { data: { session: null } };
        try {
            const res = await apiFetch('/auth/me');
            if (res.user) return { data: { session: { user: res.user } } };
        } catch(e) { /* expired */ }
        delToken();
        return { data: { session: null } };
    },
    signInWithPassword: async function(opts) {
        try {
            const res = await apiFetch('/auth/login', {
                method: 'POST',
                body: { username: opts.email||opts.username, password: opts.password },
            });
            if (res.token) { setToken(res.token); return { data:{ session:{ user:res.user } }, error:null }; }
            return { data:null, error:{ message: res.error||'Login fallito' } };
        } catch(e) { return { data:null, error:{ message:e.message } }; }
    },
    signOut: async function() { delToken(); return { error:null }; },
    signUp:  async function(opts) { return auth.admin.createUser(opts); },
    admin: {
        createUser: async function(opts) {
            try {
                const res = await apiFetch('/auth/create-user', {
                    method: 'POST',
                    body: {
                        username:         opts.username || opts.email,
                        password:         opts.password,
                        email:            opts.email,
                        name:             opts.name || opts.email,
                        role:             opts.role || 'allenatore',
                        management_role:  opts.management_role || null,
                        society_id:       opts.society_id || null,
                    },
                });
                if (res.data) return { data:{ user:res.data }, error:null };
                return { data:null, error:{ message:res.error||'Errore creazione utente' } };
            } catch(e) { return { data:null, error:{ message:e.message } }; }
        }
    }
};

// ── Expose ────────────────────────────────────────────────────
window.client = { auth, from: function(table) { return new QueryBuilder(table); } };
console.log('✅ SportTrackPro Turso client v2 loaded. API:', window.SPORTTRACK_API_URL || 'http://localhost:3001/api');

})();
