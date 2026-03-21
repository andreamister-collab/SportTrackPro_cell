// supabase/functions/delete-user/index.ts 
// Elimina un utente da Supabase Auth e da public.users
// Richiede: Authorization: Bearer <JWT dell'admin loggato>
// Body JSON: { user_id }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verifica ruolo admin del chiamante
    const { data: { user: callerUser } } = await supabaseUser.auth.getUser();
    if (!callerUser) {
      return new Response(JSON.stringify({ error: "Token non valido" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users").select("role").eq("id", callerUser.id).maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Solo gli amministratori possono eliminare utenti" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id obbligatorio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Impedisci auto-eliminazione
    if (user_id === callerUser.id) {
      return new Response(JSON.stringify({ error: "Non puoi eliminare te stesso" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica che il target non sia admin
    const { data: targetProfile } = await supabaseAdmin
      .from("users").select("role").eq("id", user_id).maybeSingle();

    if (targetProfile?.role === "admin") {
      return new Response(JSON.stringify({ error: "Non puoi eliminare un altro amministratore" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Elimina da public.users (cascade RLS)
    await supabaseAdmin.from("users").delete().eq("id", user_id);

    // Elimina da Auth
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (authDelErr) {
      return new Response(JSON.stringify({ error: "Errore eliminazione Auth: " + authDelErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
