const SUPABASE_URL = 'https://saoghfehqrjgobcpiebz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhb2doZmVocXJqZ29iY3BpZWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NzgwMTcsImV4cCI6MjA4OTE1NDAxN30.3i6bHXbdmKppLt8r2n4YCD5rgeFnm6veeFPmReDmOMY';
// Inizializziamo il client e lo rendiamo globale per l'app
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Rendiamo 'client' disponibile ovunque nel progetto
window.client = client;
