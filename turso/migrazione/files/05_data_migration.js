#!/usr/bin/env node
// ============================================================
// SportTrackPro — Data Migration Script
// Esporta dati da Supabase e li importa in Turso
//
// Install: npm install @supabase/supabase-js @libsql/client dotenv
// Run:     node 05_data_migration.js
// ============================================================

import { createClient as createSupabase } from '@supabase/supabase-js';
import { createClient as createTurso }    from '@libsql/client';
import 'dotenv/config';

const supabase = createSupabase(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY  // service_role key per bypassare RLS
);

const turso = createTurso({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Ordine di migrazione rispettando foreign keys
const MIGRATION_ORDER = [
    'sports',
    'societies',
    'seasons',
    'categories',
    'teams',
    'session_types',
    'athletes',
    'athlete_team_seasons',
    'parent_athletes',
    'sessions',
    'attendances',
    'match_details',
    'match_stats',
    'test_definitions',
    'test_performances',
    'test_sessions',
    'test_attendances',
    'test_results',
    'tournaments',
    'tournament_phases',
    'tournament_groups',
    'tournament_group_teams',
    'tournament_matches',
    'tournament_phase_matches',
    'user_category_seasons',
];

// Colonne da escludere (Supabase system columns)
const EXCLUDE_COLS = new Set(['created_at', 'updated_at']);

// Trasformazioni per tabella
const TRANSFORMS = {
    // Converti boolean Postgres → INTEGER SQLite
    seasons:      (row) => ({ ...row, is_active: row.is_active ? 1 : 0 }),
    match_stats:  (row) => ({ ...row, is_starter: row.is_starter ? 1 : 0 }),
    attendances:  (row) => ({ ...row, is_called_up: row.is_called_up ? 1 : 0,
                                      performance_data: row.performance_data ? JSON.stringify(row.performance_data) : null }),
    parent_athletes: (row) => ({ ...row }),
    tournament_group_teams: (row) => ({ ...row, is_our_team: row.is_our_team ? 1 : 0 }),
};

// NOTA: La tabella 'users' viene migrata separatamente (vedi commento sotto)

const migrateTable = async (table) => {
    console.log(`\n📦 Migrating: ${table}`);

    // 1. Fetch da Supabase (paginato per tabelle grandi)
    let allRows = [];
    let from = 0;
    const PAGE = 1000;

    while (true) {
        const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
        if (error) { console.error(`  ❌ Fetch error: ${error.message}`); return; }
        if (!data || !data.length) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
    }

    if (!allRows.length) { console.log(`  ⚠️  Nessuna riga, skip.`); return; }
    console.log(`  📊 ${allRows.length} righe da importare`);

    // 2. Pulisci e trasforma
    const transform = TRANSFORMS[table] || ((r) => r);
    const rows = allRows.map(row => {
        const clean = {};
        Object.entries(row).forEach(([k, v]) => {
            if (EXCLUDE_COLS.has(k)) return;
            clean[k] = v === null ? null : (typeof v === 'object' ? JSON.stringify(v) : v);
        });
        return transform(clean);
    });

    // 3. Insert in Turso in batch da 50 (transazione)
    const BATCH = 50;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const stmts = batch.map(row => {
            const cols = Object.keys(row).filter(k => row[k] !== undefined);
            const vals = cols.map(k => row[k]);
            const placeholders = cols.map(() => '?').join(', ');
            return {
                sql:  `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
                args: vals,
            };
        });

        try {
            await turso.batch(stmts, 'write');
            inserted += batch.length;
            process.stdout.write(`\r  ✅ ${inserted}/${rows.length}`);
        } catch (e) {
            console.error(`\n  ❌ Insert error at batch ${i}: ${e.message}`);
        }
    }
    console.log(`\n  ✅ Done: ${inserted} righe inserite`);
};

const migrateUsers = async () => {
    console.log('\n👤 Users — migrazione speciale (password hash)');
    console.log('  ⚠️  Gli utenti Supabase usano Auth email/password separata.');
    console.log('  ⚠️  Devi reimpostare le password manualmente.');
    console.log('  📋 Verranno migrati username, name, email, role, society_id.');
    console.log('  📋 La password_hash sarà impostata a un placeholder — cambiala via API.');

    const { data: users } = await supabase.from('users').select('id, username, name, email, role, society_id');
    if (!users?.length) return;

    const placeholder = '$2b$10$CHANGEME_RUN_RESET_PASSWORD_FOR_THIS_USER_xxxxxxxxxxxxxxxxx';

    const stmts = users.map(u => ({
        sql:  'INSERT OR REPLACE INTO users (id, username, name, email, password_hash, role, society_id) VALUES (?,?,?,?,?,?,?)',
        args: [u.id, u.username || u.email, u.name, u.email, placeholder, u.role, u.society_id],
    }));

    await turso.batch(stmts, 'write');
    console.log(`  ✅ ${users.length} utenti migrati (password da reimpostare)`);
};

const main = async () => {
    console.log('🚀 SportTrackPro — Migrazione Supabase → Turso');
    console.log('================================================');

    // Verifica connessioni
    try {
        await turso.execute('SELECT 1');
        console.log('✅ Turso connesso');
    } catch (e) {
        console.error('❌ Turso non raggiungibile:', e.message);
        process.exit(1);
    }

    for (const table of MIGRATION_ORDER) {
        await migrateTable(table);
    }

    await migrateUsers();

    console.log('\n🎉 Migrazione completata!');
    console.log('📋 Prossimi passi:');
    console.log('   1. Verifica i dati con il Turso Shell');
    console.log('   2. Reimposta le password utenti via POST /api/auth/create-user');
    console.log('   3. Testa l\'app con il nuovo client adapter');
};

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
