// Rooms app with:
// • 18+ gate (cookie)
// • Per-room uploads + gallery (no login for visitors)
// • Admin delete via password (?admin=PASS)
// • Mobile-friendly single-file server

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import mime from "mime-types";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || "changeme";
const UPLOAD_ROOT = path.join(__dirname, "uploads");

// Ensure uploads root exists
await fsp.mkdir(UPLOAD_ROOT, { recursive: true });

// ---------- helpers ----------
const safeBase = (p) => path.basename(String(p || "")).replace(/[^\w.-]/g, "_");

const parseCookies = (req) => {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map(v => v.trim()).filter(Boolean).map(v => {
      const idx = v.indexOf("=");
      if (idx === -1) return [v, ""];
      return [decodeURIComponent(v.slice(0, idx).trim()), decodeURIComponent(v.slice(idx + 1).trim())];
    })
  );
};

const isImage = (name) => /^image\//.test(mime.lookup(name) || "");
const isVideo = (name) => /^video\//.test(mime.lookup(name) || "");

// Multer storage per room
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const room = safeBase(req.params.room);
    const dir = path.join(UPLOAD_ROOT, room);
    try {
      await fsp.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || `.${mime.extension(file.mimetype) || "bin"}`;
    cb(null, `${Date.now()}_${nanoid(6)}${ext.toLowerCase()}`);
  }
});
const upload = multer({ storage });

// ---------- age-gate middleware ----------
app.use((req, res, next) => {
  // allow assets + age routes
  if (req.path.startsWith("/raw/") || req.path.startsWith("/age")) return next();

  const cookies = parseCookies(req);
  const ageOK = cookies.age_ok === "1";

  // any /room/* requires age_ok cookie
  if (req.path.startsWith("/room/") && !ageOK) {
    const redirectTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/age?redirect=${redirectTo}`);
  }
  next();
});

// ---------- static for raw files ----------
app.use("/raw", express.static(UPLOAD_ROOT, { fallthrough: false }));

// ---------- routes ----------
app.get("/", (req, res) => {
  res.type("html").send(`
<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooms</title>
<style>
  :root{--bg:#0b0c0f;--card:#111827;--fg:#e5e7eb;--mut:#9ca3af;--pri:#6366f1;--ok:#22c55e;--bad:#ef4444}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
  .card{width:min(92vw,640px);background:var(--card);border-radius:16px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  h1{margin:0 0 10px;font-size:28px}
  p{margin:0 0 16px;color:var(--mut)}
  form{display:flex;gap:8px}
  input{flex:1;padding:12px;border-radius:10px;border:1px solid #222;background:#0f1218;color:var(--fg)}
  button{padding:12px 16px;border-radius:10px;border:0;background:var(--pri);color:white;font-weight:600}
  small{color:var(--mut)}
</style>
<div class="card">
  <h1>Rooms</h1>
  <p>Create or open a public room where anyone can upload & view files (18+ only).</p>
  <form action="/room/" method="GET" onsubmit="location.href='/room/'+encodeURIComponent(this.r.value.trim());return false;">
    <input name="r" id="r" placeholder="Type a room name… (e.g. photos, dropbox, team1)" autofocus>
    <button type="submit">Open</button>
  </form>
  <p><small>Tip: share the room URL. Add <code>?admin=YOUR_PASS</code> to see delete links.</small></p>
</div>`);
});

// Age prompt
app.get("/age", (req, res) => {
  const redirect = req.query.redirect || "/";
  res.type("html").send(`
<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>18+ Check</title>
<style>
  :root{--bg:#0b0c0f;--card:#111827;--fg:#e5e7eb;--mut:#9ca3af;--ok:#22c55e;--no:#374151}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
  .card{width:min(92vw,560px);background:var(--card);border-radius:16px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center}
  h1{margin:4px 0 12px;font-size:30px}
  p{color:var(--mut);margin:0 0 18px}
  .row{display:flex;gap:10px;justify-content:center}
  a{display:inline-block;padding:12px 20px;border-radius:12px;text-decoration:none;color:#fff}
  .yes{background:var(--ok)} .no{background:var(--no)}
</style>
<div class="card">
  <h1>Are you 18 or older?</h1>
  <p>You must confirm your age to continue.</p>
  <div class="row">
    <a class="no" href="https://google.com">No</a>
    <a class="yes" href="/age/yes?redirect=${encodeURIComponent(redirect)}">Yes</a>
  </div>
</div>`);
});

// Age accept -> set cookie and bounce back
app.get("/age/yes", (req, res) => {
  const redirect = req.query.redirect || "/";
  res.setHeader("Set-Cookie", "age_ok=1; Max-Age=604800; Path=/; SameSite=Lax");
  res.redirect(redirect);
});

// Room page
app.get("/room/:room", async (req, res) => {
  const room = safeBase(req.params.room);
  if (!room) return res.redirect("/");

  const isAdmin = (req.query.admin || "") === ADMIN_PASS;
  const roomDir = path.join(UPLOAD_ROOT, room);
  await fsp.mkdir(roomDir, { recursive: true });

  const files = await fsp.readdir(roomDir).catch(() => []);
  files.sort((a, b) => fs.statSync(path.join(roomDir, b)).mtimeMs - fs.statSync(path.join(roomDir, a)).mtimeMs);

  const fileCards = files.map((name) => {
    const encodedName = encodeURIComponent(name);
    const rawUrl = `/raw/${encodeURIComponent(room)}/${encodedName}`;
    const delUrl = `/delete/${encodeURIComponent(room)}/${encodedName}?admin=${encodeURIComponent(ADMIN_PASS)}`;
    const m = mime.lookup(name) || "application/octet-stream";

    let media = `<a href="${rawUrl}" target="_blank" rel="noopener">${name}</a>`;
    if (isImage(name)) {
      media = `<a href="${rawUrl}" target="_blank" rel="noopener"><img src="${rawUrl}" alt="${name}" loading="lazy"></a>`;
    } else if (isVideo(name)) {
      media = `<video src="${rawUrl}" controls preload="metadata"></video>`;
    }

    const del = isAdmin
      ? `<a class="del" href="${delUrl}" onclick="return confirm('Delete ${name}?')">Delete</a>`
      : "";

    return `<div class="item">
      ${media}
      <div class="meta">
        <span>${name}</span>
        ${del}
      </div>
    </div>`;
  }).join("");

  res.type("html").send(`
<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${room} – Room</title>
<style>
  :root{--bg:#0b0c0f;--card:#111827;--fg:#e5e7eb;--mut:#9ca3af;--pri:#6366f1;--bad:#ef4444}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
  header{position:sticky;top:0;background:#0d1117;padding:14px 16px;border-bottom:1px solid #1f2937}
  header .row{display:flex;gap:10px;align-items:center;justify-content:space-between;max-width:980px;margin:0 auto}
  h1{margin:0;font-size:20px}
  main{max-width:980px;margin:16px auto;padding:0 14px}
  .card{background:var(--card);border-radius:14px;padding:14px;margin-bottom:14px}
  form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  input[type=file]{flex:1;min-width:240px;color:var(--mut)}
  button{padding:10px 14px;border-radius:10px;border:0;background:var(--pri);color:white;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .item{background:#0f1218;border:1px solid #1f2937;border-radius:12px;overflow:hidden}
  img,video{display:block;width:100%;height:200px;object-fit:cover;background:#0b0c0f}
  .meta{display:flex;align-items:center;justify-content:space-between;padding:10px}
  .meta span{color:var(--mut);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:75%}
  .del{color:#fff;background:var(--bad);padding:6px 10px;border-radius:8px;text-decoration:none;font-size:12px}
  .tip{color:var(--mut);font-size:13px;margin-top:6px}
  .mut{color:var(--mut)}
</style>
<header>
  <div class="row">
    <h1>Room: <span class="mut">${room}</span></h1>
    <a class="mut" href="/">All rooms</a>
  </div>
</header>
<main>
  <div class="card">
    <form action="/upload/${encodeURIComponent(room)}" method="POST" enctype="multipart/form-data">
      <input type="file" name="file" required>
      <button type="submit">Upload</button>
    </form>
    <div class="tip">Share this URL: <code>${req.protocol}://${req.get("host")}/room/${encodeURIComponent(room)}</code></div>
    <div class="tip">Admin delete links appear when you add <code>?admin=YOUR_PASS</code> to the URL.</div>
  </div>

  <div class="grid">
    ${fileCards || `<div class="item"><div class="meta"><span>No files yet. Be the first to upload!</span></div></div>`}
  </div>
</main>`);
});

// Handle uploads
app.post("/upload/:room", upload.single("file"), (req, res) => {
  const room = safeBase(req.params.room);
  res.redirect(`/room/${encodeURIComponent(room)}`);
});

// Delete (admin only)
app.get("/delete/:room/:name", async (req, res) => {
  if ((req.query.admin || "") !== ADMIN_PASS) return res.status(403).send("Forbidden");
  const room = safeBase(req.params.room);
  const name = safeBase(req.params.name);
  const filePath = path.join(UPLOAD_ROOT, room, name);

  try {
    await fsp.unlink(filePath);
  } catch (e) {
    // ignore if already gone
  }
  res.redirect(`/room/${encodeURIComponent(room)}?admin=${encodeURIComponent(ADMIN_PASS)}`);
});

// Health
app.get("/healthz", (_, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Rooms app listening on :${PORT}`);
});
