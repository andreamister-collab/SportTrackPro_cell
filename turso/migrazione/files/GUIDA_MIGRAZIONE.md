# SportTrackPro — Guida Migrazione Supabase → Turso

## Panoramica

| | Supabase | Turso |
|---|---|---|
| **DB** | PostgreSQL | SQLite (libSQL) |
| **API** | PostgREST auto-generato | Express custom (incluso) |
| **Auth** | Supabase Auth (JWT) | JWT custom (bcrypt + jsonwebtoken) |
| **Realtime** | Sì (non usato) | No (non necessario) |
| **RLS** | Sì (server-side) | Gestita nell'API server |
| **JOIN syntax** | `!inner`, nested select | SQL standard |
| **Boolean** | `true/false` | `1/0` (INTEGER) |
| **JSON** | `jsonb` nativo | `TEXT` serializzato |
| **Deploy** | Hosted | Turso Cloud + API server (Railway/Fly/VPS) |

---

## File inclusi in questo pacchetto

| File | Scopo |
|---|---|
| `01_schema.sql` | Schema completo Turso (tutte le 26 tabelle) |
| `02_api_server.js` | Server Express che espone REST API su Turso |
| `03_client_adapter.js` | Drop-in replacement del Supabase client SDK |
| `04_join_queries.sql` | Query SQL per i JOIN complessi |
| `05_data_migration.js` | Script di migrazione dati Supabase → Turso |
| `06_env_example.env` | Template variabili d'ambiente |
| `07_package.json` | Dipendenze npm |
| `08_index_html_changes.md` | Modifiche necessarie a index.html |

---

## FASE 1 — Setup Turso

### 1.1 Creare il database Turso

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# Crea database
turso db create sporttrackpro

# Ottieni URL e token
turso db show sporttrackpro
turso db tokens create sporttrackpro
```

### 1.2 Applicare lo schema

```bash
# Apri la shell Turso
turso db shell sporttrackpro

# Incolla il contenuto di 01_schema.sql
# (oppure usa il file direttamente)
turso db shell sporttrackpro < 01_schema.sql
```

### 1.3 Verificare le tabelle

```sql
-- Nel Turso shell
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- Devono comparire 26 tabelle
```

---

## FASE 2 — Setup API Server

### 2.1 Installare dipendenze

```bash
cd turso-migration/
npm install
```

### 2.2 Configurare .env

```bash
cp 06_env_example.env .env
# Editare .env con i tuoi valori:
# TURSO_DATABASE_URL=libsql://sporttrackpro.turso.io
# TURSO_AUTH_TOKEN=eyJ...
# JWT_SECRET=minimo-32-caratteri-casuali
# PORT=3001
```

### 2.3 Avviare il server

```bash
# Sviluppo
npm run dev

# Produzione
npm start

# Test rapido
curl http://localhost:3001/api/sports
# → { "data": [...], "error": null }
```

### 2.4 Deploy in produzione

**Railway (consigliato per semplicità):**
```bash
railway login
railway init
railway up
railway variables set TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... JWT_SECRET=...
```

**Fly.io:**
```bash
fly launch
fly secrets set TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... JWT_SECRET=...
fly deploy
```

---

## FASE 3 — Migrazione dati

### 3.1 Aggiungere credenziali Supabase al .env

```bash
# .env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # service_role key (NON anon key)
```

### 3.2 Eseguire la migrazione

```bash
node 05_data_migration.js
```

L'output mostrerà ogni tabella con il numero di righe migrate.
La migrazione è idempotente (usa `INSERT OR REPLACE`), può essere rieseguita.

### 3.3 Reimpostare le password utenti

Dopo la migrazione gli utenti hanno una password placeholder.
Per ogni utente:

```bash
curl -X POST http://localhost:3001/api/auth/create-user \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"user@example.com","password":"nuova-password","role":"allenatore","society_id":"..."}'
```

Oppure crea uno script di reset e invia email agli utenti con link cambio password.

---

## FASE 4 — Aggiornare index.html

Seguire le istruzioni in `08_index_html_changes.md`.

Le modifiche principali:
1. Rimuovere `<script src="supabase-js">` 
2. Aggiungere `<script>window.SPORTTRACK_API_URL = '...'</script>`
3. Cambiare import da `./db.js` a `./turso_client.js`
4. Adattare le query con JOIN (vedere `04_join_queries.sql`)

### Query da adattare (26 tabelle × medie 3 join ciascuna)

Le query che richiedono attenzione sono quelle con sintassi PostgREST come:
```javascript
.select('*, sessions!inner(team_id, session_types(name))')
.select('athletes(name, surname), teams!fk_ucs_team(name)')
```

Per trovare tutte le query da adattare in index.html:
```bash
grep -n "!inner\|!fk_\|select.*(" index.html
```

---

## FASE 5 — Test & Validazione

### 5.1 Checklist funzionale

- [ ] Login / Logout
- [ ] Dashboard KPI caricano correttamente
- [ ] Lista atleti con filtri
- [ ] Creazione/modifica atleta con visita medica
- [ ] Registrazione presenze sessione
- [ ] Statistiche per atleta
- [ ] Vista Genitore con multi-squadra
- [ ] Visite Mediche con filtro per ruolo
- [ ] Import massivo Excel
- [ ] Tornei e gironi

### 5.2 Verifica dati

```sql
-- Confronta conteggi Supabase vs Turso
SELECT 'athletes' as t, COUNT(*) FROM athletes
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'attendances', COUNT(*) FROM attendances;
```

---

## Differenze importanti da gestire

### JSON in performance_data

```javascript
// Wrapper da aggiungere all'inizio del codice nell'app
const parsePerf = (v) => {
    if (!v) return {};
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return {}; }
};
```

### Boolean filter

```javascript
// Supabase
.eq('is_active', true)

// Turso (via adapter — già gestito automaticamente)
.eq('is_active', 1)
```

### Paginator Supabase (.range())

Non supportato nell'adapter base. Per tabelle grandi usare `.limit()` e filtri incrementali.

---

## Struttura finale del progetto

```
sporttrackpro/
├── index.html              ← app frontend (modificata)
├── turso_client.js         ← adapter client (03_client_adapter.js)
├── turso-api/
│   ├── 02_api_server.js    ← server Express
│   ├── package.json
│   ├── .env
│   └── node_modules/
└── turso-migration/
    ├── 01_schema.sql
    ├── 04_join_queries.sql
    └── 05_data_migration.js
```

---

## Costi stimati

| Servizio | Piano | Costo |
|---|---|---|
| Turso DB | Free (500 DB, 9GB storage) | **€0/mese** |
| Railway API Server | Hobby | **~€5/mese** |
| **Totale** | | **~€5/mese** |

vs Supabase Pro: **~€25/mese**

