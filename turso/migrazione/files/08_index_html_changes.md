# Modifiche a index.html per Turso

## 1. Rimuovere lo script Supabase SDK

```html
<!-- RIMUOVERE questa riga: -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

## 2. Aggiungere l'URL dell'API e il client adapter

```html
<!-- AGGIUNGERE prima del primo <script> dell'app: -->
<script>
  window.SPORTTRACK_API_URL = 'https://tuo-server.railway.app/api';
  // In sviluppo: 'http://localhost:3001/api'
</script>
<script type="module" src="./turso_client.js"></script>
```

## 3. Cambiare l'import del client

```javascript
// PRIMA (db.js Supabase):
import { client } from './db.js';

// DOPO (Turso adapter):
import { client } from './turso_client.js';
```

## 4. Adattare le query con JOIN (!inner → SQL raw)

Le query Supabase che usano relazioni `!inner` o nested select come:
```javascript
client.from('attendances')
  .select('*, sessions!inner(session_date, team_id, session_types(name))')
  .eq('athlete_id', id)
```

Vanno sostituite con query SQL via `/api/query`:
```javascript
const { data } = await fetch('/api/query', {
  method: 'POST',
  headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
  body: JSON.stringify({
    sql: `SELECT att.*, sess.session_date, sess.team_id, st.name as type_name
          FROM attendances att
          JOIN sessions sess ON sess.id = att.session_id
          JOIN session_types st ON st.id = sess.type_id
          WHERE att.athlete_id = :athlete_id
          ORDER BY sess.session_date DESC`,
    args: { athlete_id: id }
  })
}).then(r => r.json());
```

## 5. Auth — differenze chiave

| Supabase | Turso (custom) |
|---|---|
| `client.auth.getSession()` | invariato (adapter compatibile) |
| `client.auth.signInWithPassword({email, password})` | usa `username` come campo email |
| `client.auth.signOut()` | invariato |
| `client.auth.admin.createUser(...)` | invariato |
| Token in cookie Supabase | Token JWT in localStorage |

## 6. Gestione performance_data (JSON)

In Supabase `performance_data` è `jsonb` (oggetto nativo).
In Turso è `TEXT` (JSON serializzato).

```javascript
// Lettura: parsare se è stringa
const perf = typeof row.performance_data === 'string'
  ? JSON.parse(row.performance_data)
  : row.performance_data;

// Scrittura: serializzare
await client.from('attendances').update({
  performance_data: JSON.stringify(perfObj)
}).eq('id', id);
```

## 7. Boolean → INTEGER

In Supabase: `is_active`, `is_called_up`, `is_starter`, `is_our_team` sono boolean.
In Turso: sono INTEGER (0/1).

Il client adapter gestisce automaticamente il confronto, ma nei filtri usare:
```javascript
.eq('is_active', 1)      // non true
.eq('is_called_up', 0)   // non false
```
