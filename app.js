// app.js — age gate on all pages, public landing (rooms only), admin page for manage,
// thumbnails, single-click uploads

import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";
import mime from "mime-types";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data");
const COOKIE_SECRET = process.env.COOKIE_SECRET || "change-me";
const AGE_COOKIE = "age_ok";
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein";
const MAX_UPLOAD_MB = 50;

fs.mkdirSync(DATA, { recursive: true });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

/* -------------------- AGE GATE -------------------- */
const ageGate = (req, res, next) => {
  const open = ["/gate", "/gate/ok", "/gate/reset", "/healthz"];
  if (open.includes(req.path)) return next();
  if (req.signedCookies[AGE_COOKIE] === "1") return next();
  res.redirect("/gate?next=" + encodeURIComponent(req.originalUrl));
};
app.use(ageGate);

app.get("/gate", (req, res) => {
  const next = req.query.next || "/";
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>18+</title>
<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0}
.card{background:#111827;border:1px solid #232936;border-radius:14px;padding:28px;max-width:560px;width:92%}
h1{margin:0 0 14px;font-size:28px} p{opacity:.85;margin:0 0 18px}
.row{display:flex;gap:10px;flex-wrap:wrap}
button,a.btn{flex:1 1 180px;padding:12px;border:0;border-radius:10px;font-weight:700;font-size:16px;cursor:pointer;text-align:center}
.yes{background:#22c55e;color:#062}.no{background:#374151;color:#cbd5e1}
</style>
<div class="card">
  <h1>Are you 18 or older?</h1>
  <p>You must confirm your age to continue.</p>
  <div class="row">
    <form method="post" action="/gate/ok">
      <input type="hidden" name="next" value="${String(next).replace(/"/g,"&quot;")}">
      <button class="yes" type="submit">Yes</button>
    </form>
    <a class="btn no" href="https://www.google.com">No</a>
  </div>
</div>`);
});

app.post("/gate/ok", (req, res) => {
  const next = req.body.next || "/";
  res.cookie(AGE_COOKIE, "1", { signed: true, httpOnly: true, sameSite: "lax", maxAge: 7*24*60*60*1000 });
  res.redirect(next);
});
app.get("/gate/reset", (_req,res)=>{ res.clearCookie(AGE_COOKIE); res.redirect("/gate"); });

/* -------------------- HELPERS -------------------- */
const listRooms = () =>
  fs.readdirSync(DATA, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

const isValidRoom = name => /^[a-z0-9-]{1,40}$/.test(name);

/* -------------------- LANDING (PUBLIC) -------------------- */
app.get("/", (req, res) => {
  const rooms = listRooms();
  const listHtml = rooms.length
    ? `<ul>${rooms.map(r => `<li class="room"><a class="btn" href="/r/${encodeURIComponent(r)}">Enter: ${r}</a></li>`).join("")}</ul>`
    : "<p>No rooms yet.</p>";

  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooms</title>
<style>
body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}
.card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:760px;margin:0 auto}
h1{margin:0 0 10px}
a.btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700}
ul{list-style:none;margin:12px 0 0;padding:0}
li.room{margin:8px 0;background:#0f172a;border:1px solid #23303f;border-radius:8px;padding:10px 12px}
.top{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}
small{opacity:.75}
</style>
<div class="card">
  <div class="top">
    <h1>Rooms</h1>
    <a class="btn" href="/admin">Admin</a>
  </div>
  <p><small>(This page lists rooms only. Room creation/deletion isn’t exposed here.)</small></p>
  <h2>Existing rooms</h2>
  ${listHtml}
</div>`);
});

/* -------------------- ROOM (PUBLIC: UPLOAD + VIEW) -------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA, req.params.room);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-100);
    cb(null, ts + "-" + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

app.get("/r/:room", (req, res) => {
  const room = req.params.room;
  if (!isValidRoom(room)) return res.status(404).send("Room not found");
  const dir = path.join(DATA, room);
  fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir).map(name => {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    const type = mime.lookup(name) || "application/octet-stream";
    return { name, bytes: stat.size, type, isImage: type.startsWith("image/") };
  });

  const items = files.map(f => {
    const enc = encodeURIComponent(f.name);
    const href = `/file/${encodeURIComponent(room)}/${enc}`;
    const thumb = f.isImage
      ? `<a href="${href}" target="_blank" rel="noopener"><img src="${href}" alt="" loading="lazy"></a>`
      : `<div class="icon" aria-hidden="true">📄</div>`;
    return `<div class="item">${thumb}
      <div class="name" title="${f.name.replace(/"/g,"&quot;")}">${f.name}</div>
      <a class="btn small" href="${href}" download>Download</a>
    </div>`;
  }).join("");

  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Room: ${room}</title>
<style>
body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}
.card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:1100px;margin:0 auto}
h1{margin:0 0 12px}
a.btn,button{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;border:0;font-weight:700}
a.btn.small{padding:8px 12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.item{background:#0f172a;border:1px solid #23303f;border-radius:10px;padding:10px}
.item img{display:block;width:100%;height:160px;object-fit:cover;border-radius:8px;border:1px solid #23303f;background:#0b0c0f}
.icon{display:grid;place-items:center;width:100%;height:160px;border-radius:8px;border:1px solid #23303f;background:#0b0c0f;font-size:42px}
.name{margin:8px 0 10px;word-break:break-word;min-height:2.4em}
form.up{margin:10px 0 18px;display:flex;gap:10px;flex-wrap:wrap}
input[type=file]{background:#0f172a;border:1px solid #23303f;color:#eaeef5;border-radius:8px;padding:10px}
.top{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}
</style>
<div class="card">
  <div class="top">
    <h1>Room: ${room}</h1>
    <div>
      <a class="btn" href="/">Rooms</a>
      <a class="btn" href="/admin">Admin</a>
    </div>
  </div>
  <form class="up" method="post" action="/upload/${encodeURIComponent(room)}" enctype="multipart/form-data" onsubmit="return lockUpload(this)">
    <input id="f" type="file" name="file" required>
    <button id="u" type="submit">Upload</button>
  </form>
  <div class="grid">${items}</div>
</div>
<script>
function lockUpload(form){
  var u=document.getElementById('u'), f=document.getElementById('f');
  if(!f.files||!f.files[0]) return false;
  u.disabled=true; u.textContent='Uploading…';
  setTimeout(function(){ f.value=''; },0);
  return true;
}
</script>`);
});

app.post("/upload/:room", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file");
  res.redirect("/r/" + encodeURIComponent(req.params.room));
});

app.get("/file/:room/:name", (req, res) => {
  const p = path.join(DATA, req.params.room, req.params.name);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.sendFile(p);
});

/* -------------------- ADMIN (PASSWORD) -------------------- */
app.get("/admin", (req, res) => {
  const ok = req.query.pass === ADMIN_PASS;
  if (!ok) {
    // password prompt
    res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin</title>
<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}
.card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:560px;margin:0 auto}
h1{margin:0 0 12px} input,button{padding:10px;border-radius:10px;border:1px solid #23303f;background:#0f172a;color:#eaeef5}
button{border:0;background:#4f46e5;color:#fff;font-weight:700}
form{display:flex;gap:8px;flex-wrap:wrap}
a.btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700}
</style>
<div class="card">
  <h1>Admin login</h1>
  <form method="get" action="/admin">
    <input type="password" name="pass" placeholder="Password" required>
    <button type="submit">Enter</button>
  </form>
  <p><a class="btn" href="/">Back</a></p>
</div>`);
    return;
  }

  const rooms = listRooms();
  const rows = rooms.length
    ? `<ul>${rooms.map(r => `
        <li style="margin:8px 0;display:flex;gap:8px;align-items:center">
          <code style="background:#0f172a;border:1px solid #23303f;border-radius:8px;padding:6px 8px">${r}</code>
          <a class="btn" href="/r/${encodeURIComponent(r)}">Open</a>
          <form method="post" action="/admin/delete" onsubmit="return confirm('Delete room & files: ${r}?')">
            <input type="hidden" name="pass" value="${ADMIN_PASS}">
            <input type="hidden" name="room" value="${r}">
            <button class="danger" type="submit">Delete</button>
          </form>
        </li>`).join("")}</ul>`
    : "<p>No rooms yet.</p>";

  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin</title>
<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}
.card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:760px;margin:0 auto}
h1{margin:0 0 12px}
a.btn,button{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;border:0;font-weight:700}
button.danger{background:#ef4444}
input{padding:10px;border-radius:10px;border:1px solid #23303f;background:#0f172a;color:#eaeef5}
form.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
small{opacity:.75}
</style>
<div class="card">
  <h1>Admin</h1>
  <p><small>Logged in with password.</small></p>
  <h2>Create room</h2>
  <form class="row" method="post" action="/admin/create">
    <input type="hidden" name="pass" value="${ADMIN_PASS}">
    <input name="room" required placeholder="room-name (lowercase, numbers, dashes)" pattern="[a-z0-9-]{1,40}">
    <button type="submit">Create</button>
    <a class="btn" href="/">Back</a>
  </form>
  <h2>Existing rooms</h2>
  ${rows}
</div>`);
});

app.post("/admin/create", (req, res) => {
  if (req.body.pass !== ADMIN_PASS) return res.status(403).send("Forbidden");
  const room = (req.body.room || "").trim();
  if (!isValidRoom(room)) return res.status(400).send("Invalid room name");
  fs.mkdirSync(path.join(DATA, room), { recursive: true });
  res.redirect("/admin?pass=" + encodeURIComponent(ADMIN_PASS));
});

app.post("/admin/delete", (req, res) => {
  if (req.body.pass !== ADMIN_PASS) return res.status(403).send("Forbidden");
  const room = (req.body.room || "").trim();
  if (!isValidRoom(room)) return res.status(400).send("Invalid room");
  const dir = path.join(DATA, room);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.redirect("/admin?pass=" + encodeURIComponent(ADMIN_PASS));
});

/* -------------------- health -------------------- */
app.get("/healthz", (_req,res)=>res.send("ok"));

app.listen(PORT, () => console.log("listening on", PORT));
