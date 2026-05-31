Passo 1 — Installa serve (una volta sola)
Apri il terminale (PowerShell su Windows) e scrivi:
bash

npm install -g serve

Passo 2 — Avvia il sito
bash# Vai nella cartella dove sta index.html
cd C:\Users\andre\WORK\home_sporttrackpro

# Avvia il mini server

serve .

Vedrai:
   ┌──────────────────────────────────────────┐
   │                                          │
   │   Serving!                               │
   │                                          │
   │   Local:  http://localhost:3000          │
   │                                          │
   └──────────────────────────────────────────┘
Apri il browser su http://localhost:3000 — NON aprire il file direttamente.

Passo 3 — Secondo terminale per il server API
Apri un secondo terminale (tasto destro su PowerShell → "Apri nuova finestra") e avvia il server API:
bashcd 

C:\Users\andre\WORK\home_sporttrackpro\sporttrackpro-server

node server.js

Devono girare entrambi i terminali contemporaneamente — uno per il sito, uno per l'API.

Passo 4 — Controlla che turso_client.js sia al posto giusto
La cartella deve essere così:
C:\Users\andre\WORK\home_sporttrackpro\
├── index.html
├── turso_client.js          ← deve stare QUI (stesso livello di index.html)
└── sporttrackpro-server\
    ├── server.js
    ├── package.json
    └── .env
Se turso_client.js non c'è ancora, salvalo lì prendendo il file 03_client_adapter.js che hai già scaricato e rinominandolo turso_client.js.