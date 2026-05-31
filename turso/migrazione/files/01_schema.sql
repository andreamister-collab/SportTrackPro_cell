-- ============================================================
-- SportTrackPro — Turso/libSQL Schema Migration
-- Eseguire nell'ordine indicato nel Turso Shell o via CLI
-- ============================================================

-- PRAGMA
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- TABELLE BASE (nessuna dipendenza)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sports (
    id   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS societies (
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name       TEXT NOT NULL,
    sport_id   TEXT REFERENCES sports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS seasons (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    sport_id    TEXT REFERENCES sports(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE,
    is_active   INTEGER NOT NULL DEFAULT 0   -- 0=false, 1=true (SQLite has no BOOLEAN)
);

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
    season_id   TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_types (
    id   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL
);

-- ──────────────────────────────────────────────────────────────
-- UTENTI (auth custom — no Supabase Auth)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username    TEXT NOT NULL UNIQUE,
    name        TEXT,
    email       TEXT,
    password_hash TEXT NOT NULL,   -- bcrypt hash
    role        TEXT NOT NULL DEFAULT 'allenatore',
    society_id  TEXT REFERENCES societies(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_category_seasons (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
    team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
    season_id   TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE,
    role        TEXT
);

-- ──────────────────────────────────────────────────────────────
-- ATLETI
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS athletes (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name           TEXT NOT NULL,
    surname        TEXT NOT NULL,
    born_date      TEXT,            -- ISO date: YYYY-MM-DD
    medical_expiry TEXT,            -- ISO date: YYYY-MM-DD
    society_id     TEXT REFERENCES societies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS athlete_team_seasons (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    athlete_id  TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
    season_id   TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE,
    jersey_number INTEGER,
    role        TEXT
);

CREATE TABLE IF NOT EXISTS parent_athletes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    athlete_id  TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    UNIQUE(user_id, athlete_id)
);

-- ──────────────────────────────────────────────────────────────
-- SESSIONI & PRESENZE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title        TEXT,
    session_date TEXT,              -- ISO date
    type_id      TEXT REFERENCES session_types(id),
    team_id      TEXT REFERENCES teams(id) ON DELETE CASCADE,
    society_id   TEXT REFERENCES societies(id) ON DELETE CASCADE,
    season_id    TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    notes        TEXT
);

CREATE TABLE IF NOT EXISTS attendances (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    athlete_id       TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'presente', -- presente|assente|giustificato
    is_called_up     INTEGER DEFAULT 0,
    rating           REAL,
    performance_data TEXT,          -- JSON blob
    UNIQUE(session_id, athlete_id)
);

-- ──────────────────────────────────────────────────────────────
-- PARTITE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS match_details (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    opponent_name  TEXT,
    goals_for      INTEGER DEFAULT 0,
    goals_against  INTEGER DEFAULT 0,
    match_status   TEXT,            -- vittoria|sconfitta|pareggio
    match_type     TEXT,            -- ufficiale|amichevole
    location       TEXT,            -- casa|trasferta
    notes          TEXT
);

CREATE TABLE IF NOT EXISTS match_stats (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    athlete_id      TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    goals           INTEGER DEFAULT 0,
    yellow_cards    INTEGER DEFAULT 0,
    red_cards       INTEGER DEFAULT 0,
    minutes_played  INTEGER DEFAULT 0,
    is_starter      INTEGER DEFAULT 0,
    UNIQUE(session_id, athlete_id)
);

-- ──────────────────────────────────────────────────────────────
-- TEST ATLETICI
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS test_definitions (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    unit        TEXT,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS test_performances (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    test_def_id     TEXT NOT NULL REFERENCES test_definitions(id) ON DELETE CASCADE,
    name            TEXT,
    sort_order      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_sessions (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title       TEXT,
    session_date TEXT,
    team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
    season_id   TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE,
    test_definitions TEXT  -- JSON array of test_def_ids
);

CREATE TABLE IF NOT EXISTS test_attendances (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    test_session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    athlete_id      TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    UNIQUE(test_session_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS test_results (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    test_session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    athlete_id      TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    test_def_id     TEXT NOT NULL REFERENCES test_definitions(id) ON DELETE CASCADE,
    performance_id  TEXT REFERENCES test_performances(id),
    value           REAL,
    notes           TEXT
);

-- ──────────────────────────────────────────────────────────────
-- TORNEI
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournaments (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    season_id   TEXT REFERENCES seasons(id) ON DELETE CASCADE,
    society_id  TEXT REFERENCES societies(id) ON DELETE CASCADE,
    start_date  TEXT,
    end_date    TEXT,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS tournament_phases (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    phase_type    TEXT,             -- girone|eliminazione
    sort_order    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tournament_groups (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    phase_id    TEXT NOT NULL REFERENCES tournament_phases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_group_teams (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    group_id    TEXT NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
    team_name   TEXT NOT NULL,
    is_our_team INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tournament_matches (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    group_id    TEXT NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
    home_team   TEXT,
    away_team   TEXT,
    home_goals  INTEGER,
    away_goals  INTEGER,
    match_date  TEXT,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS tournament_phases (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tournament_phase_matches (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    phase_id    TEXT NOT NULL REFERENCES tournament_phases(id) ON DELETE CASCADE,
    label       TEXT,               -- es. "Semifinale 1"
    team_a      TEXT,
    team_b      TEXT,
    goals_a     INTEGER,
    goals_b     INTEGER,
    match_date  TEXT
);

-- ──────────────────────────────────────────────────────────────
-- INDICI
-- ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ats_athlete  ON athlete_team_seasons(athlete_id);
CREATE INDEX IF NOT EXISTS idx_ats_team     ON athlete_team_seasons(team_id);
CREATE INDEX IF NOT EXISTS idx_ats_season   ON athlete_team_seasons(season_id);
CREATE INDEX IF NOT EXISTS idx_att_session  ON attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_att_athlete  ON attendances(athlete_id);
CREATE INDEX IF NOT EXISTS idx_ms_session   ON match_stats(session_id);
CREATE INDEX IF NOT EXISTS idx_ms_athlete   ON match_stats(athlete_id);
CREATE INDEX IF NOT EXISTS idx_sess_team    ON sessions(team_id);
CREATE INDEX IF NOT EXISTS idx_sess_season  ON sessions(season_id);
CREATE INDEX IF NOT EXISTS idx_ucs_user     ON user_category_seasons(user_id);
CREATE INDEX IF NOT EXISTS idx_ucs_team     ON user_category_seasons(team_id);
