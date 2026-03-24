import { supabaseUrl, supabaseAnonKey } from './config.js';

const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

 
const S = {
  user: null,
  systemRole: null,
  rolesSportivi: [],
  activeSeason: null
};

/* UTIL */
const $ = id => document.getElementById(id);
const toast = msg => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2000);
};
const setTitle = t => $('view-title').textContent = t;

/* LOGIN */
async function handleLogin(e) {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value.trim();

  if (!username || !password) {
    $('login-error').textContent = "Inserisci username e password";
    return;
  }

  const email = `${username}@mail.com`;

  const { error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (authErr) {
    $('login-error').textContent = "Credenziali non valide";
    return;
  }

  const { data: userRow, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error || !userRow) {
    $('login-error').textContent = "Profilo non trovato";
    return;
  }

  S.user = userRow;
  S.systemRole = userRow.profession?.toLowerCase() === 'admin' ? 'admin' : null;

  $('user-info').textContent = `${userRow.name || ''} (${userRow.username})`;
  $('login-view').classList.add('hidden');
  $('main-layout').classList.remove('hidden');

  await loadSeason();
  await loadRoles();
  buildSidebar();
  navigate('dashboard');
}

/* LOGOUT */
async function handleLogout() {
  await supabase.auth.signOut();
  S.user = null;
  S.systemRole = null;
  S.rolesSportivi = [];

  $('main-layout').classList.add('hidden');
  $('login-view').classList.remove('hidden');
}

/* STAGIONE */
async function loadSeason() {
  const { data } = await supabase
    .from('seasons')
    .select('*')
    .eq('active', true)
    .maybeSingle();

  S.activeSeason = data;
  $('active-season-label').textContent = data?.name || '-';
}

/* RUOLI */
async function loadRoles() {
  if (!S.user || !S.activeSeason) return;

  const { data } = await supabase
    .from('user_category_seasons')
    .select('id, role, categories(name), societies(name)')
    .eq('user_id', S.user.id)
    .eq('season_id', S.activeSeason.id);

  S.rolesSportivi = data || [];
}

/* SIDEBAR */
function buildSidebar() {
  const nav = $('sidebar-nav');
  const items = [{ id: 'dashboard', label: 'Dashboard' }];

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

    if (ruoli.includes('presidente'))
      items.push({ id: 'societies', label: 'Società' }, { id: 'staff', label: 'Staff' });

    if (ruoli.includes('responsabile'))
      items.push({ id: 'categories', label: 'Categorie' }, { id: 'teams', label: 'Squadre' });

    if (ruoli.includes('allenatore') || ruoli.includes('dirigente'))
      items.push({ id: 'athletes', label: 'Atleti' }, { id: 'matches', label: 'Partite' }, { id: 'sessions', label: 'Sessioni' });

    if (S.user.profession?.toLowerCase() === 'genitore')
      items.push({ id: 'my-athletes', label: 'I miei figli' });

    items.push({ id: 'profile', label: 'Profilo' }, { id: 'logout', label: 'Logout' });
  }

  nav.innerHTML = items
    .map(i => `<a href="#${i.id}" data-view="${i.id}">${i.label}</a>`)
    .join('');

  nav.onclick = e => {
    const a = e.target.closest('a');
    if (a) navigate(a.dataset.view);
  };
}

/* ROUTING */
function navigate(v) {
  const nav = $('sidebar-nav');
  [...nav.querySelectorAll('a')].forEach(a =>
    a.classList.toggle('active', a.dataset.view === v)
  );

  if (views[v]) views[v]();
}
/* VIEW BUILDERS */
/* VIEW BUILDERS */
const views = {

  dashboard() {
    setTitle('Dashboard');
    $('content').innerHTML = `
      <h2>Panoramica</h2>
      <p>Stagione attiva: <strong>${S.activeSeason?.name || '-'}</strong></p>
      <ul>
        ${
          S.rolesSportivi.length
            ? S.rolesSportivi.map(r =>
                `<li>${r.role} — ${r.categories?.name || ''} ${r.societies ? '(' + r.societies.name + ')' : ''}</li>`
              ).join('')
            : '<li>Nessun ruolo assegnato</li>'
        }
      </ul>
    `;
  },

  societies() {
    setTitle('Società');
    $('content').innerHTML = `
      <div class="form-inline">
        <input id="new-soc-name" placeholder="Nome società">
        <input id="new-soc-city" placeholder="Città">
        <input id="new-soc-email" placeholder="Email">
        <button class="btn btn-primary" id="add-soc">Aggiungi</button>
      </div>

      <table>
        <thead><tr><th>Nome</th><th>Città</th><th>Email</th><th></th></tr></thead>
        <tbody id="soc-body"></tbody>
      </table>
    `;

    $('add-soc').onclick = async () => {
      const name = $('new-soc-name').value.trim();
      if (!name) return;

      await supabase.from('societies').insert({
        id: crypto.randomUUID(),
        name,
        city: $('new-soc-city').value.trim(),
        email: $('new-soc-email').value.trim(),
        season_id: S.activeSeason.id
      });

      toast('Società creata');
      views.societies();
    };

    loadSocieties();
  },

  categories() {
    setTitle('Categorie');
    $('content').innerHTML = `
      <div class="form-inline">
        <input id="new-cat-name" placeholder="Nome categoria">
        <button class="btn btn-primary" id="add-cat">Aggiungi</button>
      </div>

      <table>
        <thead><tr><th>Nome</th><th></th></tr></thead>
        <tbody id="cat-body"></tbody>
      </table>
    `;

    $('add-cat').onclick = async () => {
      const name = $('new-cat-name').value.trim();
      if (!name) return;

      await supabase.from('categories').insert({
        id: crypto.randomUUID(),
        name,
        season_id: S.activeSeason.id
      });

      toast('Categoria creata');
      views.categories();
    };

    loadCategories();
  },

  teams() {
    setTitle('Squadre');
    $('content').innerHTML = `
      <div class="form-inline">
        <input id="new-team-name" placeholder="Nome squadra">
        <button class="btn btn-primary" id="add-team">Aggiungi</button>
      </div>

      <table>
        <thead><tr><th>Nome</th><th></th></tr></thead>
        <tbody id="team-body"></tbody>
      </table>
    `;

    $('add-team').onclick = async () => {
      const name = $('new-team-name').value.trim();
      if (!name) return;

      await supabase.from('teams').insert({
        id: crypto.randomUUID(),
        name
      });

      toast('Squadra creata');
      views.teams();
    };

    loadTeams();
  },

  athletes() {
    setTitle('Atleti');
    $('content').innerHTML = `
      <div class="form-inline">
        <input id="new-ath-first" placeholder="Nome">
        <input id="new-ath-last" placeholder="Cognome">
        <button class="btn btn-primary" id="add-ath">Aggiungi</button>
      </div>

      <table>
        <thead><tr><th>Nome</th><th>Cognome</th><th></th></tr></thead>
        <tbody id="ath-body"></tbody>
      </table>
    `;

    $('add-ath').onclick = async () => {
      const first = $('new-ath-first').value.trim();
      const last = $('new-ath-last').value.trim();
      if (!first || !last) return;

      await supabase.from('athletes').insert({
        id: crypto.randomUUID(),
        first_name: first,
        last_name: last,
        parent_ids: []
      });

      toast('Atleta creato');
      views.athletes();
    };

    loadAthletes();
  },

  staff() {
    setTitle('Staff');
    $('content').innerHTML = `
      <table>
        <thead><tr><th>Utente</th><th>Ruolo</th><th>Categoria</th><th>Società</th><th></th></tr></thead>
        <tbody id="staff-body"></tbody>
      </table>
    `;

    loadStaff();
  },

  matches() {
    setTitle('Partite');
    $('content').innerHTML = `<h2>Partite</h2>`;
  },

  sessions() {
    setTitle('Sessioni');
    $('content').innerHTML = `<h2>Sessioni</h2>`;
  },

  config() {
    setTitle('Config');
    $('content').innerHTML = `<h2>Configurazioni</h2>`;
  },

  profile() {
    setTitle('Profilo');
    $('content').innerHTML = `
      <h2>Profilo</h2>
      <p>Nome: ${S.user.name}</p>
      <p>Username: ${S.user.username}</p>
      <p>Email: ${S.user.email}</p>
      <p>Professione: ${S.user.profession}</p>
    `;
  },

  logout() {
    handleLogout();
  }
};

/* LOADERS & DELETE FUNCTIONS */

/* SOCIETÀ */
async function loadSocieties() {
  const { data } = await supabase
    .from('societies')
    .select('*')
    .eq('season_id', S.activeSeason.id);

  $('soc-body').innerHTML = data
    .map(
      s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.city}</td>
        <td>${s.email}</td>
        <td><button class="btn btn-danger" onclick="delSoc('${s.id}')">X</button></td>
      </tr>`
    )
    .join('');
}

async function delSoc(id) {
  await supabase.from('societies').delete().eq('id', id);
  toast('Società eliminata');
  views.societies();
}

/* CATEGORIE */
async function loadCategories() {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('season_id', S.activeSeason.id);

  $('cat-body').innerHTML = data
    .map(
      c => `
      <tr>
        <td>${c.name}</td>
        <td><button class="btn btn-danger" onclick="delCat('${c.id}')">X</button></td>
      </tr>`
    )
    .join('');
}

async function delCat(id) {
  await supabase.from('categories').delete().eq('id', id);
  toast('Categoria eliminata');
  views.categories();
}

/* SQUADRE */
async function loadTeams() {
  const { data } = await supabase.from('teams').select('*');

  $('team-body').innerHTML = data
    .map(
      t => `
      <tr>
        <td>${t.name}</td>
        <td><button class="btn btn-danger" onclick="delTeam('${t.id}')">X</button></td>
      </tr>`
    )
    .join('');
}

async function delTeam(id) {
  await supabase.from('teams').delete().eq('id', id);
  toast('Squadra eliminata');
  views.teams();
}

/* ATLETI */
async function loadAthletes() {
  const { data } = await supabase.from('athletes').select('*');

  $('ath-body').innerHTML = data
    .map(
      a => `
      <tr>
        <td>${a.first_name}</td>
        <td>${a.last_name}</td>
        <td><button class="btn btn-danger" onclick="delAth('${a.id}')">X</button></td>
      </tr>`
    )
    .join('');
}

async function delAth(id) {
  await supabase.from('athletes').delete().eq('id', id);
  toast('Atleta eliminato');
  views.athletes();
}

/* STAFF */
async function loadStaff() {
  const { data } = await supabase
    .from('user_category_seasons')
    .select('id, role, users(name,username), categories(name), societies(name)')
    .eq('season_id', S.activeSeason.id);

  $('staff-body').innerHTML = data
    .map(
      r => `
      <tr>
        <td>${r.users?.name || r.users?.username}</td>
        <td>${r.role}</td>
        <td>${r.categories?.name || '-'}</td>
        <td>${r.societies?.name || '-'}</td>
        <td><button class="btn btn-danger" onclick="delStaff('${r.id}')">X</button></td>
      </tr>`
    )
    .join('');
}

async function delStaff(id) {
  await supabase.from('user_category_seasons').delete().eq('id', id);
  toast('Ruolo rimosso');
  views.staff();
}

/* INIT */
$('login-form').addEventListener('submit', handleLogin);

/* Esportiamo funzioni globali per i pulsanti inline */
window.delSoc = delSoc;
window.delCat = delCat;
window.delTeam = delTeam;
window.delAth = delAth;
window.delStaff = delStaff;
window.navigate = navigate;
