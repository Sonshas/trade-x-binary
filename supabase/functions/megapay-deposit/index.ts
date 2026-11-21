import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, userFromRequest } from "../_shared/server.ts";

/**
 * MegaPay wallet deposits are permanently disabled on live.
 * All member deposits go through mpesa-deposit → Daraja paybill_alt (Winsoft 4088285).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to deposit." }, 401);

  if (req.method === "GET") {
    return json({
      provider: "daraja",
      enabled: false,
      message: "MegaPay deposits are disabled. Use M-Pesa Paybill 4088285.",
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return json(
    { error: "MegaPay deposits are disabled. Use M-Pesa Paybill 4088285." },
    409,
  );
});
