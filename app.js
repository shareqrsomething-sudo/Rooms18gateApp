// Rooms18gate - single-file server
// Features:
// - Rooms at /r/:room (nothing exists until created)
// - Simple gallery + file upload (no auth for viewing/uploading)
// - Admin mode via ?admin=letmein (shows delete buttons)
// - Delete FILE (admin) and DELETE ROOM with "type room name" safeguard
// - 18+ gate per room via session cookie

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import mime from "mime-types";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- config ----------
const DATA_DIR = path.join(__dirname, "data");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein"; // ?admin=letmein
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || "25", 10);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// storage per room
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const room = sanitizeRoom(req.params.room || req.body.room || "");
    if (!room) return cb(new Error("bad room"));
    await ensureRoom(room);
    cb(null, roomDir(room));
  },
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1);
    const safe = `${Date.now()}_${nanoid(6)}.${ext || "bin"}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
});

// ---------- helpers ----------
const roomDir = (room) => path.join(DATA_DIR, room);
const isAdminReq = (req) => (req.query.admin === ADMIN_PASS);
const sanitizeRoom = (name) => {
  if (typeof name !== "string") return "";
  const clean = name.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(clean) ? clean : "";
};
async function ensureBase() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}
async function ensureRoom(room) {
  await ensureBase();
  await fsp.mkdir(roomDir(room), { recursive: true });
}
async function listRooms() {
  await ensureBase();
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}
async function listFiles(room) {
  const dir = roomDir(room);
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      const st = await fsp.stat(full);
      files.push({
        name: e.name,
        size: st.size,
        mime: mime.lookup(e.name) || "application/octet-stream",
        mtime: st.mtimeMs,
      });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  } catch {
    return [];
  }
}

// ---------- middleware ----------
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ---------- age gate helpers ----------
const AGE_COOKIE_PREFIX = "age_ok_"; // per-room flag
const ageCookieName = (room) => `${AGE_COOKIE_PREFIX}${room}`;

// ---------- routes ----------

// Home: show existing rooms + create form (no default room shown unless it exists)
app.get("/", async (req, res) => {
  const rooms = await listRooms();
  const admin = isAdminReq(req);
  res.type("html").send(htmlPage(`
    <h1>Rooms</h1>
    ${admin ? `<a class="btn" href="/?">Exit admin</a>` : `<a class="btn" href="/?admin=${encodeURIComponent(ADMIN_PASS)}">Enter admin</a>`}
    <p>Pick a room to enter.</p>
    <div class="rooms">
      ${rooms.length ? rooms.map(r => `
        <div class="roomrow">
          <a class="btn" href="/r/${encodeURIComponent(r)}${admin?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}">Enter: ${escapeHtml(r)}</a>
          ${admin ? `
            <form method="post" action="/delete-room/${encodeURIComponent(r)}" class="inline" onsubmit="return confirm('Delete room \\'${escapeHtml(r)}\\' and ALL files?');">
              <input type="hidden" name="confirm" value="${escapeHtml(r)}"/>
              <button class="bad">Delete</button>
            </form>
          ` : ``}
        </div>
      `).join("") : `<p><i>No rooms yet. Create one below.</i></p>`}
    </div>

    <h2>Create Room</h2>
    <form method="post" action="/create-room" class="row">
      <input type="text" name="room" placeholder="room-name (letters/numbers/dashes)" required pattern="[a-z0-9-]{1,40}" />
      <button>Create</button>
    </form>
    <p>Only lowercase letters, numbers, and dashes. Max 40 characters.</p>
  `));
});

// create room
app.post("/create-room", async (req, res) => {
  const room = sanitizeRoom(req.body.room || "");
  if (!room) return res.status(400).send("bad room");
  await ensureRoom(room);
  // redirect straight into the room (will show age gate if not confirmed yet)
  res.redirect(`/r/${encodeURIComponent(room)}${isAdminReq(req)?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}`);
});

// room page (age gate then gallery)
app.get("/r/:room", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(404).send("room not found");

  // if room directory doesn't exist -> 404 (room must be created explicitly)
  const dirExists = fs.existsSync(roomDir(room));
  if (!dirExists) return res.status(404).send("room not found");

  const admin = isAdminReq(req);

  // age gate cookie?
  const ageCookie = req.cookies[ageCookieName(room)] === "1";
  if (!ageCookie) {
    return res.type("html").send(htmlPage(ageGate(room, admin)));
  }

  const files = await listFiles(room);
  res.type("html").send(htmlPage(roomPage(room, files, admin)));
});

// handle 18+ confirm
app.post("/age-ok/:room", (req, res) => {
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(400).send("bad room");
  res.cookie(ageCookieName(room), "1", { httpOnly: false, sameSite: "Lax", maxAge: 365*24*3600*1000 });
  res.redirect(`/r/${encodeURIComponent(room)}${isAdminReq(req)?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}`);
});

// upload file to room
app.post("/upload/:room", upload.single("file"), async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(400).send("bad room");
  if (!req.file) return res.status(400).send("no file");
  res.redirect(`/r/${encodeURIComponent(room)}${isAdminReq(req)?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}`);
});

// serve file
app.get("/file/:room/:name", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name || "");
  if (!room || !name) return res.status(400).send("bad request");
  const full = path.join(roomDir(room), name);
  if (!fs.existsSync(full)) return res.status(404).send("not found");
  res.type(mime.lookup(full) || "application/octet-stream");
  fs.createReadStream(full).pipe(res);
});

// download file
app.get("/download/:room/:name", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name || "");
  if (!room || !name) return res.status(400).send("bad request");
  const full = path.join(roomDir(room), name);
  if (!fs.existsSync(full)) return res.status(404).send("not found");
  res.download(full, name);
});

// delete file (admin only)
app.post("/delete/:room/:name", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name || "");
  if (!room || !name) return res.status(400).send("bad request");
  const full = path.join(roomDir(room), name);
  try { await fsp.unlink(full); } catch {}
  res.redirect(`/r/${encodeURIComponent(room)}?admin=${encodeURIComponent(ADMIN_PASS)}`);
});

// delete whole room (admin + confirm typed room)
app.post("/delete-room/:room", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(400).send("bad room");
  const typed = (req.body?.confirm || "").trim();
  if (typed !== room) return res.status(400).send("confirmation mismatch");
  await fsp.rm(roomDir(room), { recursive: true, force: true });
  res.redirect(`/${isAdminReq(req)?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}`);
});

// ---------- views ----------
function htmlPage(inner) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rooms</title>
<style>
:root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--accent:#22c55e;--accent2:#6366f1;--bad:#ef4444}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
main{max-width:900px;margin:0 auto;padding:28px}
h1,h2{margin:8px 0 12px}
p{color:var(--mut)}
.card{background:var(--card);padding:18px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.35)}
.btn{display:inline-block;padding:10px 14px;border-radius:10px;background:var(--accent2);color:#fff;text-decoration:none;border:none;cursor:pointer}
.btn:hover{opacity:.95}
.bad{background:var(--bad);color:#fff;border:none;border-radius:10px;padding:10px 14px;cursor:pointer}
.inline{display:inline-block;margin-left:8px}
.row{display:flex;gap:10px;flex-wrap:wrap}
input[type=text],input[type=file]{flex:1;min-width:220px;padding:10px;border-radius:10px;border:1px solid #333;background:#0f1420;color:#fff}
.rooms{display:grid;gap:10px}
.roomrow{display:flex;align-items:center;gap:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:12px}
.tile{background:#0f1420;border:1px solid #1f2937;border-radius:12px;padding:10px}
.tile img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:#0b0c0f}
small{color:var(--mut)}
.center{display:flex;align-items:center;justify-content:center;min-height:50vh}
.warn{color:#fbbf24;margin-top:8px}
</style>
</head><body>
<main class="card">
${inner}
</main>
</body></html>`;
}

function ageGate(room, admin) {
  const back = admin ? `?admin=${encodeURIComponent(ADMIN_PASS)}` : "";
  return `
  <div class="center">
    <div>
      <h1>18+</h1>
      <p>You must confirm your age to enter <b>${escapeHtml(room)}</b>.</p>
      <form method="post" action="/age-ok/${encodeURIComponent(room)}${back}">
        <button class="btn" type="submit">I am 18 or older</button>
      </form>
      <p class="warn" style="margin-top:12px">You’ll be remembered for this room only.</p>
    </div>
  </div>`;
}

function roomPage(room, files, admin) {
  return `
  <h1>Room: ${escapeHtml(room)}</h1>
  <p>Upload and view files for this room.${admin?` <b>Admin mode.</b>`:""}</p>

  <form class="row" method="post" enctype="multipart/form-data" action="/upload/${encodeURIComponent(room)}${admin?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}">
    <input type="file" name="file" required />
    <button class="btn" type="submit">Upload</button>
    <a class="btn" href="/${admin?`?admin=${encodeURIComponent(ADMIN_PASS)}`:""}">Rooms</a>
  </form>

  ${admin ? `
    <h2 style="margin-top:18px">Danger zone</h2>
    <form class="row" id="delRoomForm" method="post" action="/delete-room/${encodeURIComponent(room)}">
      <input type="text" name="confirm" id="confirmRoom" placeholder="type: ${room}" required />
      <button class="bad" id="delRoomBtn" type="submit" disabled>Delete Room</button>
    </form>
    <script>
      (()=>{
        const inp=document.getElementById('confirmRoom');
        const btn=document.getElementById('delRoomBtn');
        const must='${room}';
        const enable=()=>{ btn.disabled = (inp.value.trim() !== must); };
        inp.addEventListener('input', enable); enable();
        document.getElementById('delRoomForm').addEventListener('submit', (e)=>{
          if(inp.value.trim() !== must){ e.preventDefault(); alert('Please type the room name exactly.'); }
          else if(!confirm('Delete room "'+must+'" and ALL its files?')){ e.preventDefault(); }
        });
      })();
    </script>
  ` : ``}

  <h2 style="margin-top:18px">Files</h2>
  <div class="grid">
    ${files.length ? files.map(f => fileTile(room, f, admin)).join("") : `<p><i>No files yet.</i></p>`}
  </div>
  `;
}

function fileTile(room, f, admin){
  const imgTypes = ["image/jpeg","image/png","image/webp","image/gif","image/avif"];
  const isImg = imgTypes.includes(f.mime);
  const src = `/file/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}`;
  const dl  = `/download/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}`;
  const del = `/delete/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}?admin=${encodeURIComponent(ADMIN_PASS)}`;
  return `
    <div class="tile">
      ${isImg ? `<a href="${src}" target="_blank"><img src="${src}" alt=""></a>` : `<div style="height:140px;display:flex;align-items:center;justify-content:center;background:#0b0c0f;border-radius:8px"><small>${escapeHtml(f.mime)}</small></div>`}
      <div style="margin-top:8px">
        <small>${escapeHtml(f.name)} · ${(f.size/1024/1024).toFixed(1)} MB</small>
      </div>
      <div class="row" style="margin-top:8px">
        <a class="btn" href="${dl}">Download</a>
        ${admin ? `<form method="post" action="${del}" onsubmit="return confirm('Delete ${escapeHtml(f.name)}?')"><button class="bad">Delete</button></form>` : ``}
      </div>
    </div>
  `;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- start ----------
await ensureBase();
app.listen(PORT, () => {
  console.log("Rooms server on :" + PORT);
});
