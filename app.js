// Rooms app with:
// - 18+ gate on every page
// - Create/list rooms (no default "general")
// - Per-room uploads + gallery
// - Admin mode via password -> shows delete controls + delete-room
// - Mobile-friendly single-file server

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import mime from "mime-types";
import cookieParser from "cookie-parser";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---- CONFIG ----
const DATA_DIR = path.join(__dirname, "data");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein"; // set on Render if you want
await fsp.mkdir(DATA_DIR, { recursive: true });

// ---- helpers ----
const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const sanitizeRoom = (raw) => {
  if (!raw) return null;
  const m = String(raw).match(ROOM_RE);
  return m ? m[0] : null;
};
const roomDir = (room) => path.join(DATA_DIR, room);

const listRooms = () => {
  try {
    return fs
      .readdirSync(DATA_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
};

const isAdminReq = (req) => req.cookies && req.cookies.admin === "1";

// ---- uploads ----
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const room = sanitizeRoom(req.params.room);
    if (!room) return cb(new Error("bad room"));
    const dir = roomDir(room);
    try {
      await fsp.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    cb(null, `${Date.now()}_${nanoid(8)}.${ext}`);
  }
});
const upload = multer({ storage });

// ---- HOME (no hard-coded 'general') ----
app.get("/", (req, res) => {
  const admin = isAdminReq(req);
  const rooms = listRooms();

  const roomLinks = rooms.length
    ? rooms.map(r => `<a class="btn" href="/room/${encodeURIComponent(r)}">Enter: ${r}</a>`).join("")
    : `<p style="margin-top:10px;color:#9ca3af">No rooms yet.</p>`;

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Rooms</title>
<style>
:root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--ok:#16a34a;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font-family:system-ui,Segoe UI,Roboto}
.wrap{max-width:920px;width:96vw;margin:28px auto}.card{background:var(--card);border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
h1{margin:0 0 16px}.row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.btn,button,input[type=text]{background:#374151;color:#fff;border:1px solid #4b5563;border-radius:10px;padding:12px 14px;cursor:pointer;text-decoration:none}
.ok{background:var(--ok);border-color:#15803d}.bad{background:var(--bad);border-color:#b91c1c}
.hide{display:none}a{color:#a5b4fc;text-decoration:none}
#ageGate{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center}
#ageGate .card{max-width:520px}
input[type=text]{flex:1;min-width:220px}
</style></head><body>
<div class="wrap"><div class="card">
  <h1>Rooms</h1>
  <p>Pick a room to enter.</p>
  <div class="row">${roomLinks}</div>

  <div class="row">
    <button id="adminBtn" ${admin ? 'class="hide"' : ""}>Admin</button>
    <button id="logoutBtn" class="${admin ? '' : 'hide'} bad">Exit admin</button>
  </div>

  <div id="createBlock" class="${admin ? '' : 'hide'}">
    <h3>Create Room</h3>
    <div class="row">
      <input id="roomName" type="text" placeholder="room-name (letters/numbers/dashes)"/>
      <button id="createBtn" class="ok">Create</button>
    </div>
    <p style="color:#9ca3af">Only lowercase letters, numbers, and dashes. Max 40 characters.</p>
  </div>
</div></div>

<div id="ageGate" class="card"><div class="card">
  <h1>18+</h1><p>You must be of legal age to access this content.</p>
  <div class="row"><button id="yes" class="ok">Yes</button><button id="no" class="bad">No</button></div>
</div></div>

<script>
// 18+ gate
const gate=document.getElementById('ageGate');
if(sessionStorage.getItem('age-ok')==='1') gate.style.display='none';
document.getElementById('yes').onclick=()=>{sessionStorage.setItem('age-ok','1');gate.style.display='none'};
document.getElementById('no').onclick=()=>{location.href='https://www.google.com'};

// admin login/logout
const adminBtn=document.getElementById('adminBtn'); const logoutBtn=document.getElementById('logoutBtn');
if(adminBtn) adminBtn.onclick=async()=>{const pass=prompt('Admin password'); if(!pass)return;
  const r=await fetch('/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass})});
  if(r.ok) location.reload(); else alert('Wrong password');
};
if(logoutBtn) logoutBtn.onclick=async()=>{await fetch('/admin/logout',{method:'POST'}); location.reload();};

// create room
const createBtn=document.getElementById('createBtn');
if(createBtn){ createBtn.onclick=async()=>{
  const raw=(document.getElementById('roomName').value||'').trim();
  const r=await fetch('/create-room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:raw})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) return alert(j.msg||'Create failed');
  location.href=j.url;
};}
</script></body></html>`;
  res.type("html").send(html);
});

// ---- admin session (very simple cookie) ----
app.post("/admin", (req, res) => {
  if ((req.body?.pass || "") !== ADMIN_PASS) return res.status(401).json({ ok: false });
  res.cookie("admin", "1", { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true });
});
app.post("/admin/logout", (req, res) => {
  res.clearCookie("admin");
  res.json({ ok: true });
});

// ---- create room (admin only) ----
app.post("/create-room", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ msg: "admin only" });
  const name = sanitizeRoom(req.body?.name);
  if (!name) return res.status(400).json({ msg: "invalid room name" });
  const dir = roomDir(name);
  await fsp.mkdir(dir, { recursive: true });
  return res.json({ ok: true, url: `/room/${encodeURIComponent(name)}` });
});

// ---- room page ----
app.get("/room/:room", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(404).send("Room not found");
  const admin = isAdminReq(req);

  const dir = roomDir(room);
  await fsp.mkdir(dir, { recursive: true });
  const files = (await fsp.readdir(dir)).sort().reverse();

  const items = files.map(f => {
    const p = `/files/${encodeURIComponent(room)}/${encodeURIComponent(f)}`;
    const ext = (f.split(".").pop() || "").toLowerCase();
    const img = ["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)
      ? `<img src="${p}" alt="${f}" style="width:180px;max-height:160px;object-fit:cover;border-radius:10px;display:block;margin-bottom:8px"/>`
      : `<div style="width:180px;height:120px;border:1px solid #374151;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:8px">.${ext||"file"}</div>`;
    const del = admin
      ? `<form method="post" action="/delete/${encodeURIComponent(room)}/${encodeURIComponent(f)}" onsubmit="return confirm('Delete ${f}?')"><button class="btn bad">Delete</button></form>`
      : "";
    return `<div class="card" style="padding:12px;width:200px">
      ${img}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="${p}" download>Download</a>${del}
      </div>
      <div style="color:#9ca3af;margin-top:6px;font-size:12px">${f}</div>
    </div>`;
  }).join("");

  const html = `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Room: ${room}</title>
<style>
:root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--ok:#16a34a;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font-family:system-ui,Segoe UI,Roboto}
.wrap{max-width:1040px;width:96vw;margin:28px auto}.card{background:var(--card);border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
h1{margin:0 0 16px}.row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.btn,button,input[type=file]{background:#374151;color:#fff;border:1px solid #4b5563;border-radius:10px;padding:12px 14px;cursor:pointer;text-decoration:none}
.ok{background:var(--ok);border-color:#15803d}.bad{background:var(--bad);border-color:#b91c1c}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-top:14px}
#ageGate{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center}
#ageGate .card{max-width:520px}
</style></head><body>
<div class="wrap"><div class="card">
  <h1>Room: ${room}</h1>
  <p>Upload and view files for this room.${admin ? "" : " Admins can log in from the home page."}</p>

  <form class="row" id="upForm">
    <input id="file" type="file" name="file" />
    <button class="ok" type="submit">Upload</button>
    <a class="btn" href="/">Rooms</a>
    ${admin ? `<form method="post" action="/delete-room/${room}" onsubmit="return confirm('Delete entire room?')">
      <button class="bad" type="submit">Delete Room</button></form>` : ""}
  </form>

  <div class="grid">${items || `<div style="color:#9ca3af">No files yet.</div>`}</div>
</div></div>

<div id="ageGate" class="card"><div class="card">
  <h1>18+</h1><p>You must be of legal age to access this content.</p>
  <div class="row"><button id="yes" class="ok">Yes</button><button id="no" class="bad">No</button></div>
</div></div>

<script>
const gate=document.getElementById('ageGate');
if(sessionStorage.getItem('age-ok')==='1') gate.style.display='none';
document.getElementById('yes').onclick=()=>{sessionStorage.setItem('age-ok','1');gate.style.display='none'};
document.getElementById('no').onclick=()=>{location.href='https://www.google.com'};

document.getElementById('upForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f=document.getElementById('file').files[0];
  if(!f) return alert('Pick a file');
  const fd=new FormData(); fd.append('file', f);
  const r=await fetch('/upload/${encodeURIComponent(room)}',{method:'POST',body:fd});
  if(!r.ok){ const t=await r.text(); alert('Upload failed: '+t); return; }
  location.reload();
});
</script></body></html>`;
  res.type("html").send(html);
});

// ---- file routes ----
app.post("/upload/:room", upload.single("file"), (req, res) => {
  if (!sanitizeRoom(req.params.room)) return res.status(400).send("bad room");
  if (!req.file) return res.status(400).send("no file");
  res.json({ ok: true, file: req.file.filename });
});

app.get("/files/:room/:name", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name || "");
  if (!room || !name) return res.status(404).end();
  const p = path.join(roomDir(room), name);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

app.post("/delete/:room/:name", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name || "");
  if (!room || !name) return res.status(400).send("bad params");
  await fsp.rm(path.join(roomDir(room), name), { force: true });
  res.redirect(`/room/${encodeURIComponent(room)}`);
});

app.post("/delete-room/:room", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  if (!room) return res.status(400).send("bad room");
  await fsp.rm(roomDir(room), { recursive: true, force: true });
  res.redirect("/");
});

// ---- start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("listening on", PORT);
});
