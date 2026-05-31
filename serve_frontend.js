#!/usr/bin/env node
// ============================================================
// SportTrackPro — Server frontend statico
// Serve index.html su http://localhost:3000
//
// Uso:  node serve_frontend.js
//   o:  npm run frontend   (se aggiungi lo script nel package.json)
// ============================================================

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.FRONTEND_PORT || 3000;

// Servi tutti i file statici dalla cartella corrente
app.use(express.static(__dirname));

// Qualsiasi route non trovata → rimanda all'index (SPA fallback)
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n✅ Frontend SportTrackPro disponibile su http://localhost:${PORT}`);
    console.log(`   API backend atteso su http://localhost:3001\n`);
});
