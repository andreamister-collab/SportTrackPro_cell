-- ============================================================
-- SportTrackPro — Query SQL per i JOIN complessi
-- Turso non supporta PostgREST "!inner" syntax
-- Questi vanno eseguiti via POST /api/query
-- ============================================================

-- ── 1. Atleti con assegnazioni (ex: athlete_team_seasons + teams + categories) ──
SELECT
    ats.id,
    ats.athlete_id,
    ats.jersey_number,
    ats.role,
    ats.team_id,
    ats.category_id,
    ats.season_id,
    ats.society_id,
    a.name        AS athlete_name,
    a.surname     AS athlete_surname,
    a.born_date,
    a.medical_expiry,
    t.name        AS team_name,
    c.name        AS category_name,
    s.name        AS society_name
FROM athlete_team_seasons ats
JOIN athletes    a ON a.id = ats.athlete_id
LEFT JOIN teams      t ON t.id = ats.team_id
LEFT JOIN categories c ON c.id = ats.category_id
LEFT JOIN societies  s ON s.id = ats.society_id
WHERE ats.season_id = :season_id
ORDER BY a.surname, a.name;

-- ── 2. Presenze sessione con dati atleta e tipo sessione ──────
SELECT
    att.id,
    att.session_id,
    att.athlete_id,
    att.status,
    att.is_called_up,
    att.rating,
    att.performance_data,
    a.name        AS athlete_name,
    a.surname     AS athlete_surname,
    sess.session_date,
    sess.title    AS session_title,
    sess.team_id,
    st.name       AS session_type_name
FROM attendances att
JOIN athletes     a    ON a.id    = att.athlete_id
JOIN sessions     sess ON sess.id = att.session_id
JOIN session_types st  ON st.id   = sess.type_id
WHERE att.athlete_id = :athlete_id
ORDER BY sess.session_date DESC;

-- ── 3. Match stats con dettagli partita ───────────────────────
SELECT
    ms.id,
    ms.session_id,
    ms.athlete_id,
    ms.goals,
    ms.yellow_cards,
    ms.red_cards,
    ms.minutes_played,
    ms.is_starter,
    sess.session_date,
    sess.team_id,
    md.opponent_name,
    md.goals_for,
    md.goals_against,
    md.match_status,
    md.match_type,
    md.location
FROM match_stats ms
JOIN sessions      sess ON sess.id = ms.session_id
LEFT JOIN match_details md   ON md.session_id = sess.id
WHERE ms.athlete_id = :athlete_id
ORDER BY sess.session_date DESC;

-- ── 4. Staff per team con dati utente ────────────────────────
SELECT
    ucs.id,
    ucs.team_id,
    ucs.category_id,
    ucs.role,
    ucs.season_id,
    u.name        AS user_name,
    u.email       AS user_email,
    t.name        AS team_name,
    c.name        AS category_name
FROM user_category_seasons ucs
JOIN users       u ON u.id = ucs.user_id
LEFT JOIN teams      t ON t.id = ucs.team_id
LEFT JOIN categories c ON c.id = ucs.category_id
WHERE ucs.season_id = :season_id;

-- ── 5. Visite mediche scadute con staff ───────────────────────
SELECT
    a.id           AS athlete_id,
    a.name,
    a.surname,
    a.medical_expiry,
    s.name         AS society_name,
    c.name         AS category_name,
    t.name         AS team_name,
    GROUP_CONCAT(CASE WHEN ucs.role LIKE '%allenatore%' THEN u.name END, ', ') AS allenatori,
    GROUP_CONCAT(CASE WHEN ucs.role LIKE '%responsabile%' THEN u.name END, ', ') AS responsabili
FROM athletes a
JOIN athlete_team_seasons ats ON ats.athlete_id = a.id
LEFT JOIN societies  s   ON s.id = a.society_id
LEFT JOIN teams      t   ON t.id = ats.team_id
LEFT JOIN categories c   ON c.id = ats.category_id
LEFT JOIN user_category_seasons ucs ON ucs.team_id = ats.team_id AND ucs.season_id = ats.season_id
LEFT JOIN users u ON u.id = ucs.user_id
WHERE (
    a.medical_expiry IS NULL
    OR a.medical_expiry < date('now')
    OR a.medical_expiry <= date('now', '+60 days')
)
GROUP BY a.id, ats.team_id
ORDER BY a.medical_expiry ASC NULLS FIRST, a.surname;

-- ── 6. Statistiche atleta aggregate (dashboard presidente) ───
SELECT
    a.id           AS athlete_id,
    a.surname,
    a.name,
    ats.team_id,
    t.name         AS team_name,
    c.name         AS category_name,
    s.name         AS society_name,
    COUNT(DISTINCT CASE WHEN att.status = 'presente' AND st.name NOT LIKE '%gar%' THEN att.session_id END) AS sess_pres,
    COUNT(DISTINCT CASE WHEN att.status = 'assente'  AND st.name NOT LIKE '%gar%' THEN att.session_id END) AS sess_ass,
    COUNT(DISTINCT CASE WHEN st.name NOT LIKE '%gar%' THEN att.session_id END) AS sess_tot,
    COUNT(DISTINCT CASE WHEN att.is_called_up = 1 THEN att.session_id END) AS conv,
    COALESCE(SUM(ms.goals), 0)          AS gol,
    COALESCE(SUM(ms.minutes_played), 0) AS minuti
FROM athletes a
JOIN athlete_team_seasons ats ON ats.athlete_id = a.id AND ats.season_id = :season_id
LEFT JOIN teams      t   ON t.id = ats.team_id
LEFT JOIN categories c   ON c.id = ats.category_id
LEFT JOIN societies  s   ON s.id = a.society_id
LEFT JOIN attendances att ON att.athlete_id = a.id
LEFT JOIN sessions    sess ON sess.id = att.session_id AND sess.season_id = :season_id
LEFT JOIN session_types st ON st.id = sess.type_id
LEFT JOIN match_stats ms  ON ms.athlete_id = a.id AND ms.session_id = att.session_id
GROUP BY a.id, ats.team_id
ORDER BY a.surname, a.name;
