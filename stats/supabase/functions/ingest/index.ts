// Gamla Skolan – tar emot kills och spelarstatus från rankpluginet.
// Kräver hemligheten INGEST_TOKEN (sätts i Supabase → Edge Functions → Secrets).
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const str = (v: unknown, max = 64) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown) => v === true;
const int = (v: unknown) => (Number.isFinite(v) ? Math.trunc(v as number) : 0);
const steamId = (v: unknown) => (typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null);
const date = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = Deno.env.get("INGEST_TOKEN") ?? "";
  const given = req.headers.get("x-ingest-token") ?? "";
  if (expected.length < 20 || !safeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { kills?: unknown[]; players?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const kills = (Array.isArray(body.kills) ? body.kills : []).slice(0, 500).flatMap((k: any) => {
    const attacker_id = steamId(k?.attacker_id);
    const victim_id = steamId(k?.victim_id);
    if (attacker_id === null || victim_id === null) return [];
    return [{
      at: date(k.at),
      map: str(k.map),
      mode: str(k.mode, 32),
      weapon: str(k.weapon, 32),
      headshot: bool(k.headshot),
      ranked: bool(k.ranked),
      attacker_id,
      attacker_name: str(k.attacker_name),
      attacker_bot: bool(k.attacker_bot),
      victim_id,
      victim_name: str(k.victim_name),
      victim_bot: bool(k.victim_bot),
    }];
  });

  const players = (Array.isArray(body.players) ? body.players : []).slice(0, 200).flatMap((p: any) => {
    const id = steamId(p?.steam_id);
    if (id === null || id === "0") return [];
    return [{
      steam_id: id,
      name: str(p.name),
      points: Math.max(0, int(p.points)),
      kills: Math.max(0, int(p.kills)),
      deaths: Math.max(0, int(p.deaths)),
      last_seen: date(p.last_seen),
      updated_at: new Date().toISOString(),
    }];
  });

  // Människor som bara finns i kills (t.ex. spelat ensam mot bottar) får en spelarrad utan poäng.
  const seen = new Map<string, string>();
  for (const k of kills) {
    if (!k.attacker_bot && k.attacker_id !== "0") seen.set(k.attacker_id, k.attacker_name);
    if (!k.victim_bot && k.victim_id !== "0") seen.set(k.victim_id, k.victim_name);
  }
  const fullIds = new Set(players.map((p) => p.steam_id));
  const minimal = [...seen].filter(([id]) => !fullIds.has(id)).map(([steam_id, name]) => ({ steam_id, name }));

  if (minimal.length) {
    const { error } = await supabase.from("players").upsert(minimal, { onConflict: "steam_id", ignoreDuplicates: true });
    if (error) return new Response(error.message, { status: 500 });
  }
  if (players.length) {
    const { error } = await supabase.from("players").upsert(players, { onConflict: "steam_id" });
    if (error) return new Response(error.message, { status: 500 });
  }
  if (kills.length) {
    const { error } = await supabase.from("kills").insert(kills);
    if (error) return new Response(error.message, { status: 500 });
  }

  return Response.json({ ok: true, kills: kills.length, players: players.length + minimal.length });
});
