// supabase/functions/create-user/index.ts 
// Crea un utente in Supabase Auth + riga in public.users
// Richiede: Authorization: Bearer <JWT dell'admin loggato>
// Body JSON: { username, password, name, role, email, profession, phone, society_id }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verifica che il chiamante sia autenticato e sia admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client con la service_role key (disponibile solo nelle Edge Functions)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Client con il JWT dell'utente chiamante per verificare il ruolo
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verifica che il chiamante sia admin
    const { data: { user: callerUser }, error: callerErr } = await supabaseUser.auth.getUser();
    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ error: "Token non valido" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", callerUser.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Solo gli amministratori possono creare utenti" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Leggi i dati del nuovo utente
    const body = await req.json();
    const { username, password, name, role, email, profession, phone, society_id } = body;

    if (!username || !password || !name || !role) {
      return new Response(JSON.stringify({ error: "username, password, name e role sono obbligatori" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authEmail = email || `${username}@sporttrackpro.it`;

    // Verifica che username non esista già
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: `Username "${username}" già in uso` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Crea utente in Supabase Auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true, // nessuna email di conferma necessaria
      user_metadata: { name, username, role },
    });

    if (authErr) {
      return new Response(JSON.stringify({ error: authErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = authData.user.id;

    // 4. Crea riga in public.users
    const { error: profileErr } = await supabaseAdmin.from("users").insert({
      id:         newUserId,
      name:       name,
      username:   username,
      email:      authEmail,
      role:       role,
      profession: profession || "",
      phone:      phone || "",
      society_id: society_id || null,
    });

    if (profileErr) {
      // Rollback: elimina l'utente Auth appena creato
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({ error: "Errore salvataggio profilo: " + profileErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: newUserId, username, name, role, email: authEmail },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
