import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.libsql://test-andreamister-collab.aws-eu-west-1.turso.io,
  authToken: process.env.eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzkwNDQ2NjUsImlkIjoiMDE5ZTIzNTctZGMwMS03OTY3LWFlM2ItNmEyYzMwY2ZkMjQxIiwicmlkIjoiZTMxODQwYjEtOTdmOS00MDIxLTgzZmQtMzMzOTdjYzRkZjUwIn0.U_WwoFMaVWsHqfJfNeKXsUyxHlZIKTqeEgywpdSd_HtjUpnpyG7odsxJZ5ybyZBQQKfzQBbJ4IKVSC2AZQHEBg,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Metodo non consentito' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Dati mancanti" });
  }

  try {
    // 1. Cerca l'utente nel database Turso
    let result = await client.execute({
      sql: "SELECT name FROM users WHERE username = ? AND password = ?",
      args: [username, password],
    });

    // 2. SIMULAZIONE: Se non esiste, lo creiamo al volo per il test
    if (result.rows.length === 0) {
      const newId = Math.random().toString(36).substring(2, 15); // ID temporaneo veloce
      
      await client.execute({
        sql: "INSERT INTO users (id, username, password, name, role) VALUES (?, ?, ?, ?, ?)",
        args: [newId, username, password, `Utente ${username}`, "manager"],
      });

      // Recuperiamo l'utente appena inserito
      result = await client.execute({
        sql: "SELECT name FROM users WHERE username = ? AND password = ?",
        args: [username, password],
      });
    }

    // 3. Ritorna il nome trovato nella tabella
    const user = result.rows[0];
    return res.status(200).json({ success: true, name: user.name });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}