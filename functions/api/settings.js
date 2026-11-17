// Cloudflare Pages Function  →  served at /api/settings
//
// Needs two things set in your Pages project (see the steps in the chat):
//   • a KV namespace bound as  SETTINGS
//   • a secret named           adminpassword   (ADMIN_PASSWORD also works)
//
// The password is only ever checked here, on the server. It is never in the HTML.

const KEY = "settings";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Compare two strings without leaking where they differ (hash both, compare in constant time).
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// Anyone can read the current amount / due date (the page needs them).
export async function onRequestGet({ env }) {
  if (!env.SETTINGS) return json({});
  const raw = await env.SETTINGS.get(KEY);
  return json(raw ? JSON.parse(raw) : {});
}

// Only someone with the password can change them.
export async function onRequestPost({ request, env }) {
  const secret = env.adminpassword || env.ADMIN_PASSWORD;
  if (!secret || !env.SETTINGS) return json({ error: "Server is not set up yet." }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  const ok = await sameSecret(String(body.password || ""), String(secret));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600)); // slows down password guessing
    return json({ error: "Wrong password." }, 401);
  }

  if (body.action === "verify") return json({ ok: true });
  if (body.action !== "save") return json({ error: "Unknown action." }, 400);

  const raw = await env.SETTINGS.get(KEY);
  const next = raw ? JSON.parse(raw) : {};

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000)
    return json({ error: "Enter a valid amount." }, 400);
  next.amount = Math.round(amount * 100) / 100;

  const due = String(body.due || "");
  if (due === "") delete next.due;                 // back to the automatic monthly date
  else if (validDate(due)) next.due = due;
  else return json({ error: "Enter a valid due date." }, 400);

  await env.SETTINGS.put(KEY, JSON.stringify(next));
  return json({ ok: true, settings: next });
}
