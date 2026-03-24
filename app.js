import { supabaseUrl, supabaseAnonKey } from './config.js';

const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

const S = {
  user: null,          // riga di users
  systemRole: null,    // 'admin' o null (per ora da users.profession)
  rolesSportivi: [],   // righe user_category_seasons per stagione attiva
  activeSeason: null
};

/* UTIL */

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

function setViewTitle(title) {
  document.getElementById('view-title').textContent = title;
}

function setActiveSeasonLabel() {
  document.getElementById('active-season-label').textContent =
    S.activeSeason ? S.activeSeason.name : '-';
}

/* BADGE RUOLI */

function getRoleBadgeClass(role) {
  const map = {
    admin: 'badge-blue',
    presidente: 'badge-purple',
    responsabile: 'badge-green',
    dirigente: 'badge-gold',
    professionista: 'badge-teal',
    allenatore: 'badge-blue',
    genitore: 'badge-gray'
  };
  return map[role] || 'badge-gray';
}

/* STAGIONE ATTIVA */

async function ensureActiveSeason() {
  if (S.activeSeason) return;
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.error(error);
    showToast('Errore nel recupero stagione attiva');
    return;
  }
  S.activeSeason = data;
  setActiveSeasonLabel();
}

/* RUOLI SPORTIVI */

async function loadRuoliSportivi() {
  if (!S.user || !S.activeSeason) return;
  const { data, error } = await supabase
    .from('user_category_seasons')
    .select('id, role, categories(name), societies(name)')
    .eq('user_id', S.user.id)
    .eq('season_id', S.activeSeason.id);

  if (error) {
    console.error(error);
    showToast('Errore nel recupero ruoli');
    return;
  }
  S.rolesSportivi = data || [];
}

/* LOGIN: username + password, email = username@mail.com */

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';

  if (!username || !password) {
    errBox.textContent = 'Inserisci username e password';
    return;
  }

  const emailForAuth = `${username}@mail.com`;

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: emailForAuth,
    password
  });

  if (authErr) {
    errBox.textContent = 'Credenziali non valide';
    return;
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (userErr || !userRow) {
    errBox.textContent = 'Profilo utente non trovato';
    return;
  }

  S.user = userRow;
  S.systemRole = (userRow.profession && userRow.profession.toLowerCase() === 'admin')
    ? 'admin'
    : null;

  document.getElementById('user-info').textContent =
    `${userRow.name || ''} (${userRow.username})`;

  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('main-layout').classList.remove('hidden');

  await ensureActiveSeason();
  await loadRuoliSportivi();
  buildSidebar();
  navigate('dashboard');
}

async function handleLogout() {
  await supabase.auth.signOut();
  S.user = null;
  S.systemRole = null;
  S.rolesSportivi = [];
  document.getElementById('main-layout').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
}

/* SIDEBAR DINAMICA */

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const items = [];

  items.push({ id: 'dashboard', label: 'Dashboard' });

  if (S.systemRole === 'admin') {
    items.push(
      { id: 'societies', label: 'Società' },
      { id: 'categories', label: 'Categorie' },
      { id: 'teams', label: 'Squadre' },
      { id: 'athletes', label: 'Atleti' },
      { id: 'staff', label: 'Staff' },
      { id: 'matches', label: 'Partite' },
      { id: 'sessions', label: 'Sessioni' },
      { id: 'config', label: 'Config' },
      { id: 'profile', label: 'Profilo' },
      { id: 'logout', label: 'Logout' }
    );
  } else {
    const ruoli = S.rolesSportivi.map(r => r.role);

    if (ruoli.includes('presidente')) {
      items.push(
        { id: 'societies', label: 'Società' },
        { id: 'staff', label: 'Staff' }
      );
    }
    if (ruoli.includes('responsabile')) {
      items.push(
        { id: 'categories', label: 'Categorie' },
        { id: 'teams', label: 'Squadre' }
      );
    }
    if (ruoli.includes('allenatore') || ruoli.includes('dirigente')) {
      items.push(
        { id: 'athletes', label: 'Atleti' },
        { id: 'matches', label: 'Partite' },
        { id: 'sessions', label: 'Sessioni' }
      );
    }
    if (S.user.profession && S.user.profession.toLowerCase() === 'genitore') {
      items.push({ id: 'my-athletes', label: 'I miei figli' });
    }

    items.push(
      { id: 'profile', label: 'Profilo' },
      { id: 'logout', label: 'Logout' }
    );
  }

  nav.innerHTML = items.map(i => `<a href="#${i.id}" data-view="${i.id}">${i.label}</a>`).join('');

  nav.onclick = (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    const view = a.dataset.view;
    navigate(view);
  };
}

/* VIEW BUILDERS */

const viewBuilders = {

  dashboard: async () => {
    setViewTitle('Dashboard');
    const el = document.getElementById('content');
    el.innerHTML = `
      <h2>Panoramica</h2>
      <p>Stagione attiva: <strong>${S.activeSeason ? S.activeSeason.name : '-'}</strong></p>
      <p>Ruoli stagionali:</p>
      <ul>
        ${S.rolesSportivi.map(r => `
          <li>
            <span class="${getRoleBadgeClass(r.role)}">${r.role}</span>
            — ${r.categories ? r.categories.name : ''} ${r.societies ? '(' + r.societies.name + ')' : ''}
          </li>
        `).join('') || '<li>Nessun ruolo assegnato per questa stagione.</li>'}
      </ul>
    `;
  },

  societies: async () => {
    setViewTitle('Società');
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="form-inline">
        <input type="text" id="new-soc-name" placeholder="Nome società">
        <input type="text" id="new-soc-city" placeholder="Città">
        <input type="email" id="new-soc-email" placeholder="Email">
        <button class="btn btn-primary" id="btn-add-soc">Aggiungi</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Città</th><th>Email</th><th>Stagione</th><th>Azioni</th></tr></thead>
        <tbody id="soc-tbody"></tbody>
      </table>
    `;

    document.getElementById('btn-add-soc').onclick = async () => {
      const name = document.getElementById('new-soc-name').value.trim();
      const city = document.getElementById('new-soc-city').value.trim();
      const email = document.getElementById('new-soc-email').value.trim();
      if (!name || !S.activeSeason) return;
      const { error } = await supabase.from('societies').insert({
        id: crypto.randomUUID(),
        name,
        city,
        email,
        season_id: S.activeSeason.id
      });
      if (error) { showToast('Errore creazione società'); return; }
      showToast('Società creata');
      viewBuilders.societies();
    };

    const { data, error } = await supabase
      .from('societies')
      .select('*')
      .eq('season_id', S.activeSeason.id)
      .order('name');

    if (error) { showToast('Errore caricamento società'); return; }

    const tbody = document.getElementById('soc-tbody');
    tbody.innerHTML = data.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.city}</td>
        <td>${s.email}</td>
        <td>${S.activeSeason ? S.activeSeason.name : '-'}</td>
        <td><button class="btn btn-danger" data-id="${s.id}" data-action="del-soc">Elimina</button></td>
      </tr>
    `).join('');

    tbody.onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'del-soc') {
        const id = btn.dataset.id;
        const { error } = await supabase.from('societies').delete().eq('id', id);
        if (error) { showToast('Errore eliminazione società'); return; }
        showToast('Società eliminata');
        viewBuilders.societies();
      }
    };
  },

  categories: async () => {
    setViewTitle('Categorie');
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="form-inline">
        <input type="text" id="new-cat-name" placeholder="Nome categoria">
        <button class="btn btn-primary" id="btn-add-cat">Aggiungi</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Stagione</th><th>Azioni</th></tr></thead>
        <tbody id="cat-tbody"></tbody>
      </table>
    `;

    document.getElementById('btn-add-cat').onclick = async () => {
      const name = document.getElementById('new-cat-name').value.trim();
      if (!name || !S.activeSeason) return;
      const { error } = await supabase.from('categories').insert({
        id: crypto.randomUUID(),
        name,
        season_id: S.activeSeason.id
      });
      if (error) { showToast('Errore creazione categoria'); return; }
      showToast('Categoria creata');
      viewBuilders.categories();
    };

    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('season_id', S.activeSeason.id)
      .order('name');

    if (error) { showToast('Errore caricamento categorie'); return; }

    const tbody = document.getElementById('cat-tbody');
    tbody.innerHTML = data.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${S.activeSeason ? S.activeSeason.name : '-'}</td>
        <td><button class="btn btn-danger" data-id="${c.id}" data-action="del-cat">Elimina</button></td>
      </tr>
    `).join('');

    tbody.onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'del-cat') {
        const id = btn.dataset.id;
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) { showToast('Errore eliminazione categoria'); return; }
        showToast('Categoria eliminata');
        viewBuilders.categories();
      }
    };
  },

  teams: async () => {
    setViewTitle('Squadre');
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="form-inline">
        <input type="text" id="new-team-name" placeholder="Nome squadra">
        <button class="btn btn-primary" id="btn-add-team">Aggiungi</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Azioni</th></tr></thead>
        <tbody id="team-tbody"></tbody>
      </table>
    `;

    document.getElementById('btn-add-team').onclick = async () => {
      const name = document.getElementById('new-team-name').value.trim();
      if (!name) return;
      const { error } = await supabase.from('teams').insert({
        id: crypto.randomUUID(),
        name
      });
      if (error) { showToast('Errore creazione squadra'); return; }
      showToast('Squadra creata');
      viewBuilders.teams();
    };

    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('name');

    if (error) { showToast('Errore caricamento squadre'); return; }

    const tbody = document.getElementById('team-tbody');
    tbody.innerHTML = data.map(t => `
      <tr>
        <td>${t.name}</td>
        <td><button class="btn btn-danger" data-id="${t.id}" data-action="del-team">Elimina</button></td>
      </tr>
    `).join('');

    tbody.onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'del-team') {
        const id = btn.dataset.id;
        const { error } = await supabase.from('teams').delete().eq('id', id);
        if (error) { showToast('Errore eliminazione squadra'); return; }
        showToast('Squadra eliminata');
        viewBuilders.teams();
      }
    };
  },

  athletes: async () => {
    setViewTitle('Atleti');
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="form-inline">
        <input type="text" id="new-ath-first" placeholder="Nome">
        <input type="text" id="new-ath-last" placeholder="Cognome">
        <button class="btn btn-primary" id="btn-add-ath">Aggiungi</button>
      </div>
      <table>
        <thead><tr><th>Nome</th><th>Cognome</th><th>Azioni</th></tr></thead>
        <tbody id="ath-tbody"></tbody>
      </table>
    `;

    document.getElementById('btn-add-ath').onclick = async () => {
      const first = document.getElementById('new-ath-first').value.trim();
      const last = document.getElementById('new-ath-last').value.trim();
      if (!first || !last) return;
      const { error } = await supabase.from('athletes').insert({
        id: crypto.randomUUID(),
        first_name: first,
        last_name: last,
        parent_ids: []
      });
      if (error) { showToast('Errore creazione atleta'); return; }
      showToast('Atleta creato');
      viewBuilders.athletes();
    };

    const { data, error } = await supabase
      .from('athletes')
      .select('*')
      .order('last_name');

    if (error) { showToast('Errore caricamento atleti'); return; }

    const tbody = document.getElementById('ath-tbody');
    tbody.innerHTML = data.map(a => `
      <tr>
        <td>${a.first_name}</td>
        <td>${a.last_name}</td>
        <td><button class="btn btn-danger" data-id="${a.id}" data-action="del-ath">Elimina</button></td>
      </tr>
    `).join('');

    tbody.onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'del-ath') {
        const id = btn.dataset.id;
        const { error } = await supabase.from('athletes').delete().eq('id', id);
        if (error) { showToast('Errore eliminazione atleta'); return; }
        showToast('Atleta eliminato');
        viewBuilders.athletes();
      }
    };
  },

  staff: async () => {
    setViewTitle('Staff');
    const el = document.getElementById('content');
    el.innerHTML = `
      <table>
        <thead><tr><th>Utente</th><th>Ruolo</th><th>Categoria</th><th>Società</th><th>Azioni</th></tr></thead>
        <tbody id="staff-tbody"></tbody>
      </table>
    `;

    const { data, error } = await supabase
      .from('user_category_seasons')
      .select('id, role, users(name,username,email), categories(name), societies(name)')
      .eq('season_id', S.activeSeason.id);

    if (error) { showToast('Errore caricamento staff'); return; }

    const tbody = document.getElementById('staff-tbody');
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${r.users ? (r.users.name || r.users.username || r.users.email) : '-'}</td>
        <td><span class="${getRoleBadgeClass(r.role)}">${r.role}</span></td>
        <td>${r.categories ? r.categories.name : '-'}</td>
        <td>${r.societies ? r.societies.name : '-'}</td>
        <td><button class="btn btn-danger" data-id="${r.id}" data-action="del-staff">Rimuovi</button></td>
      </tr>
    `).join('');

    tbody.onclick = async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'del-staff') {
        const id = btn.dataset.id;
        const { error } = await supabase.from('user_category_seasons').delete().eq('id', id);
        if (error) { showToast('Errore rimozione ruolo'); return; }
        showToast('Ruolo rimosso');
        viewBuilders.staff();
      }
    };
  },

  matches: async () => {
    setViewTitle('Partite');
    document.getElementById('content').innerHTML = `
      <h2>Partite</h2>
      <p>Qui potrai in seguito gestire partite, convocati, marcatori.</p>
    `;
  },

  sessions: async () => {
    setViewTitle('Sessioni');
    document.getElementById('content').innerHTML = `
      <h2>Sessioni</h2>
      <p>Qui potrai in seguito gestire allenamenti e presenze.</p>
    `;
  },

  config: async () => {
    setViewTitle('Config');
    document.getElementById('content').innerHTML = `
      <h2>Configurazioni</h2>
      <p>Gestione chiavi di configurazione (tabella config).</p>
    `;
  },

  'my-athletes': async () => {
    setViewTitle('I miei figli');
    document.getElementById('content').innerHTML = `
      <h2>I miei figli</h2>
      <p>Da collegare a athletes.parent_ids in base all'utente genitore.</p>
    `;
  },

  profile: async () => {
    setViewTitle('Profilo');
    document.getElementById('content').innerHTML = `
      <h2>Profilo utente</h2>
      <p>Nome: ${S.user ? S.user.name : '-'}</p>
      <p>Username: ${S.user ? S.user.username : '-'}</p>
      <p>Email: ${S.user ? S.user.email : '-'}</p>
      <p>Professione: ${S.user ? S.user.profession : '-'}</p>
    `;
  },

  logout: async () => {
    await handleLogout();
  }
};

/* ROUTING */

async function navigate(view) {
  const nav = document.getElementById('sidebar-nav');
  [...nav.querySelectorAll('a')].forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  if (!viewBuilders[view]) {
    setViewTitle('404');
    document.getElementById('content').innerHTML = `<h2>404</h2><p>Pagina non trovata.</p>`;
    return;
  }
  await viewBuilders[view]();
}

window.addEventListener('hashchange', () => {
  const view = location.hash.replace('#', '') || 'dashboard';
  navigate(view);
});

/* INIT */

document.getElementById('login-form').addEventListener('submit', handleLogin);
