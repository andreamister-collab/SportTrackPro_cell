	# SportTrackPro — Gestione Utenti e Password (Supabase vs Turso)

---

## Il problema attuale con Supabase (onestà)

Oggi nell'app esistono **due posti separati** dove un utente viene creato,
e devono essere tenuti manualmente sincronizzati:

```
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│  Supabase Auth Dashboard        │    │  Sezione "Gestione Staff"        │
│  (admin.supabase.com)           │    │  nell'app                        │
│                                 │    │                                  │
│  Crei: mario@asd.it / pass123   │    │  Crei: nome, username, ruolo     │
│  → genera UUID auth             │    │  → inserisce in public.users     │
│                                 │    │                                  │
│  ⚠️ Non sa il ruolo/società      │    │  ⚠️ Non gestisce la password     │
└─────────────────────────────────┘    └─────────────────────────────────┘
                    │                                  │
                    └──── collegati via email ─────────┘
                          (campo comune)
```

**Conseguenza pratica:**
- Se l'admin crea un utente solo in "Gestione Staff" → non può fare login
  (manca l'account in Supabase Auth)
- Se l'admin crea un utente solo su Supabase Dashboard → può fare login
  ma l'app non sa il suo ruolo (la `checkActiveSession` non trova il record in `users`)
- Il cambio password non esiste nell'app → l'utente deve contattare l'admin
  che va su Supabase Dashboard

---

## La situazione con Turso (come risolverla bene)

Con Turso **tutto è in un posto solo**: la tabella `users` con `password_hash`.
Non c'è più un sistema Auth separato. Questo è un vantaggio, ma dobbiamo
gestire esplicitamente tutti i flussi che Supabase gestiva in automatico.

### I flussi da gestire:

| Scenario | Chi agisce | Come |
|---|---|---|
| Creare il primo admin | Dev/voi | Script CLI una tantum |
| Admin crea un nuovo utente | Admin nell'app | Form con password temporanea |
| Utente cambia la propria password | Utente nell'app | Form "Cambia password" |
| Utente dimentica la password | Admin | Reset manuale o email automatica |

---

## SCENARIO 1 — Creare il primo admin (setup iniziale)

Questo si fa una sola volta, da terminale, prima di avviare l'app.

```bash
# 1. Genera l'hash della password
node -e "
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('LatuaPassword123!', 10);
console.log(hash);
"
# Output: $2b$10$abc...xyz  ← copia questo valore

# 2. Inserisci l'admin in Turso
turso db shell sporttrackpro

# Nel Turso Shell:
INSERT INTO users (
    id, username, name, email, password_hash, role, society_id
) VALUES (
    lower(hex(randomblob(16))),
    'admin',
    'Amministratore',
    'admin@tuasocieta.it',
    '$2b$10$abc...xyz',   ← incolla l'hash generato sopra
    'admin',
    NULL
);
```

Fatto. Ora puoi fare login con `admin` / `LatuaPassword123!`.

---

## SCENARIO 2 — Admin crea un nuovo utente (dall'app)

Il form "Gestione Staff" attuale non gestisce la password.
Bisogna aggiungere un campo password temporanea al modale di creazione.

### Come funziona il flusso corretto:

```
Admin compila il form:
  Nome: Mario Rossi
  Username: mario.rossi
  Email: mario@asd.it
  Ruolo: Allenatore
  Società: ASD Santena
  Password temporanea: Cambia123!     ← CAMPO NUOVO
        │
        ▼
App chiama: POST /api/auth/create-user
        │
        ▼
API Server:
  1. Genera hash bcrypt della password
  2. INSERT INTO users (id, username, name, email, password_hash, role, society_id)
  3. Restituisce { id, username, name, role, society_id }
        │
        ▼
Admin comunica a Mario: "Username: mario.rossi  Password: Cambia123!"
Mario fa login e cambia subito la password dal suo profilo
```

### Modifica da fare al modale staff nell'app:

Aggiungere al form di **creazione** (non modifica) il campo password:

```javascript
// Nel modale openStaffModal, per !isEdit:
const passwordField = !isEdit ? `
    <div>
        <label>PASSWORD TEMPORANEA *</label>
        <input type="password" id="st-password" class="modal-input" 
               placeholder="Min. 8 caratteri" autocomplete="new-password">
        <p style="font-size:0.75em;color:var(--text-sub);margin-top:4px;">
            L'utente dovrà cambiarla al primo accesso.
        </p>
    </div>` : `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);
                border-radius:8px;padding:10px 14px;font-size:0.8rem;color:#92400e;">
        🔑 Per reimpostare la password usa il pulsante apposito nella riga utente.
    </div>`;
```

---

## SCENARIO 3 — Utente cambia la propria password

Questo flusso oggi non esiste nell'app. Va aggiunto un pannello nel profilo utente.

### Endpoint API da aggiungere al server:

```javascript
// In 02_api_server.js — aggiungi questo endpoint

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, async (req, res) => {
    const { current_password, new_password } = req.body;
    
    if (!new_password || new_password.length < 8) {
        return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
    }
    
    try {
        // 1. Recupera l'utente corrente
        const result = await db.execute({
            sql:  'SELECT password_hash FROM users WHERE id = :id',
            args: { id: req.user.id },
        });
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        
        // 2. Verifica la password attuale
        const valid = await bcrypt.compare(current_password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Password attuale non corretta' });
        
        // 3. Hash della nuova password e salvataggio
        const new_hash = await bcrypt.hash(new_password, 10);
        await db.execute({
            sql:  'UPDATE users SET password_hash = :hash WHERE id = :id',
            args: { hash: new_hash, id: req.user.id },
        });
        
        res.json({ success: true, message: 'Password aggiornata con successo' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/reset-password  (solo admin — resetta la password di un altro utente)
app.post('/api/auth/reset-password', auth, async (req, res) => {
    if (!['admin','manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Solo admin può resettare le password' });
    }
    
    const { user_id, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
        return res.status(400).json({ error: 'Password troppo corta (min 8 caratteri)' });
    }
    
    try {
        const new_hash = await bcrypt.hash(new_password, 10);
        await db.execute({
            sql:  'UPDATE users SET password_hash = :hash WHERE id = :id',
            args: { hash: new_hash, id: user_id },
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
```

### UI da aggiungere nell'app (pannello profilo):

```javascript
// Aggiungi un pulsante "🔑 Cambia Password" nella sidebar o nel menu utente
// Che apre questo modale:

window.openChangePasswordModal = function() {
    modal.open('🔑 Cambia Password', `
        <div style="display:grid;gap:14px;">
            <div>
                <label style="font-size:0.75rem;font-weight:700;color:var(--text-muted);
                       text-transform:uppercase;display:block;margin-bottom:4px;">
                    Password Attuale
                </label>
                <input type="password" id="cp-current" 
                       style="width:100%;box-sizing:border-box;padding:10px;
                              border-radius:8px;border:1px solid var(--border);">
            </div>
            <div>
                <label style="font-size:0.75rem;font-weight:700;color:var(--text-muted);
                       text-transform:uppercase;display:block;margin-bottom:4px;">
                    Nuova Password (min. 8 caratteri)
                </label>
                <input type="password" id="cp-new"
                       style="width:100%;box-sizing:border-box;padding:10px;
                              border-radius:8px;border:1px solid var(--border);">
            </div>
            <div>
                <label style="font-size:0.75rem;font-weight:700;color:var(--text-muted);
                       text-transform:uppercase;display:block;margin-bottom:4px;">
                    Conferma Nuova Password
                </label>
                <input type="password" id="cp-confirm"
                       style="width:100%;box-sizing:border-box;padding:10px;
                              border-radius:8px;border:1px solid var(--border);">
            </div>
        </div>
    `);
    
    document.getElementById('btn-modal-save').textContent = '🔑 Aggiorna Password';
    document.getElementById('btn-modal-save').onclick = async () => {
        const current = document.getElementById('cp-current').value;
        const newPass = document.getElementById('cp-new').value;
        const confirm = document.getElementById('cp-confirm').value;
        
        if (newPass !== confirm) return alert('Le password non coincidono');
        if (newPass.length < 8) return alert('La password deve avere almeno 8 caratteri');
        
        const token = localStorage.getItem('stp_token');
        const res = await fetch(window.SPORTTRACK_API_URL + '/auth/change-password', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ current_password: current, new_password: newPass })
        }).then(r => r.json());
        
        if (res.success) {
            modal.close();
            alert('✅ Password aggiornata con successo!');
        } else {
            alert('❌ ' + (res.error || 'Errore aggiornamento'));
        }
    };
};
```

---

## SCENARIO 4 — Utente dimentica la password

### Opzione A — Reset manuale dall'admin (semplice, adatto a piccole associazioni)

```
Utente: "Ho dimenticato la password"
Admin: va in Gestione Staff, clicca 🔑 su quell'utente
       inserisce una nuova password temporanea
       la comunica all'utente via WhatsApp/telefono
Utente: fa login con la password temporanea e la cambia subito
```

**UI da aggiungere:** un pulsante 🔑 nella riga utente della tabella staff:

```javascript
// Nella renderStaffTable, aggiungere accanto a ✏️ e 🗑️:
`<button class="btn-sm" onclick="handleResetPassword('${u.id}','${u.name}')"
         title="Reimposta password" style="background:rgba(245,158,11,0.1);color:#d97706;">
    🔑
</button>`

// E la funzione:
window.handleResetPassword = function(userId, userName) {
    const newPass = prompt(`Nuova password per ${userName} (min. 8 caratteri):`);
    if (!newPass || newPass.length < 8) return alert('Password troppo corta');
    
    fetch(window.SPORTTRACK_API_URL + '/auth/reset-password', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('stp_token')}`
        },
        body: JSON.stringify({ user_id: userId, new_password: newPass })
    }).then(r => r.json()).then(res => {
        if (res.success) alert(`✅ Password reimpostata per ${userName}`);
        else alert('Errore: ' + res.error);
    });
};
```

### Opzione B — Email automatica (più professionale, richiede un servizio email)

Se vuoi mandare un link di reset via email puoi aggiungere:
- **Resend** (gratuito 3.000 email/mese) — integrazione semplice
- **Nodemailer + Gmail** — gratuito ma configurazione più lunga

Il flusso sarebbe:
1. Utente clicca "Password dimenticata" sul login
2. Inserisce la sua email
3. L'API genera un token temporaneo (scadenza 1 ora) e lo salva in una tabella `password_resets`
4. Manda un'email con il link `https://tuoapp.it/reset?token=xxx`
5. L'utente clicca, inserisce la nuova password
6. L'API verifica il token, aggiorna l'hash, invalida il token

---

## Riepilogo — Chi fa cosa

```
┌──────────────────────────────────────────────────────────────────┐
│                     GESTIONE PASSWORD                            │
├─────────────────┬────────────────────────────────────────────────┤
│ Chi             │ Cosa può fare                                   │
├─────────────────┼────────────────────────────────────────────────┤
│ Dev (setup)     │ Crea il primo admin via CLI/terminale           │
├─────────────────┼────────────────────────────────────────────────┤
│ Admin nell'app  │ Crea nuovi utenti con password temporanea       │
│                 │ Reimposta password di qualsiasi utente (🔑)     │
├─────────────────┼────────────────────────────────────────────────┤
│ Ogni utente     │ Cambia la propria password dal pannello profilo │
│                 │ (inserendo quella attuale + quella nuova)       │
├─────────────────┼────────────────────────────────────────────────┤
│ Utente che      │ Contatta l'admin (manuale)                      │
│ ha dimenticato  │ Oppure clicca "Password dimenticata" (email)    │
└─────────────────┴────────────────────────────────────────────────┘
```

---

## Confronto con la situazione Supabase attuale

| Funzione | Supabase (ora) | Turso (dopo) |
|---|---|---|
| Crea primo admin | Dashboard Supabase + inserimento manuale in `users` | Script CLI una tantum |
| Admin crea utente | 2 posti separati (Dashboard + app) — incoerente | 1 solo form nell'app ✅ |
| Utente cambia password | Non esiste nell'app ❌ | Form nel profilo utente ✅ |
| Password dimenticata | Email Supabase automatica | Admin reset (manuale) o email con Resend |
| Sicurezza password | bcrypt via Supabase | bcrypt via API server (identico) |
| Token sessione | JWT Supabase (7 giorni) | JWT custom (configurabile) |

---

## Gli step concreti ordinati per iniziare

```
GIORNO 1 — Setup base
  □ Crea database Turso
  □ Applica schema (01_schema.sql)
  □ Configura .env
  □ Avvia API server

GIORNO 1 — Primo admin
  □ Genera hash password: node -e "console.log(require('bcryptjs').hashSync('Pass123!',10))"
  □ INSERT INTO users con l'hash
  □ Testa login: curl -X POST http://localhost:3001/api/auth/login \
                      -d '{"username":"admin","password":"Pass123!"}'
  □ Ricevi il JWT token → funziona ✅

GIORNO 2 — Integra app
  □ Modifica index.html (rimuovi Supabase SDK, aggiungi turso_client.js)
  □ Testa tutte le pagine
  □ Adatta le query con !inner

GIORNO 3 — Completa gestione utenti
  □ Aggiungi campo password al form creazione staff
  □ Aggiungi endpoint /auth/change-password al server
  □ Aggiungi pulsante 🔑 reset nella tabella staff
  □ Aggiungi pannello "Cambia Password" per ogni utente
```

