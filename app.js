// Rooms18gate — 18+ enforced per room, no Create on homepage, /manage for admin
// Includes debug route to clear age cookies.

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
const PORT = process.env.PORT || 10000;

const DATA_DIR = path.join(__dirname, "data");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein";
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || "25", 10);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const roomDir = (r) => path.join(DATA_DIR, r);
const sanitizeRoom = (s) => {
  if (typeof s !== "string") return "";
  const t = s.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(t) ? t : "";
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdminReq = (req) => req.cookies?.admin === "1";
const setAdmin = (res) => res.cookie("admin", "1", { httpOnly: true, sameSite: "Lax", maxAge: 24 * 3600 * 1000 });
const clearAdmin = (res) => res.clearCookie("admin");

async function ensureBase() { await fsp.mkdir(DATA_DIR, { recursive: true }); }
async function ensureRoom(r) { await ensureBase(); await fsp.mkdir(roomDir(r), { recursive: true }); }
async function listRooms() {
  await ensureBase();
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}
async function listFiles(room) {
  try {
    const entries = await fsp.readdir(roomDir(room), { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(roomDir(room), e.name);
      const st = await fsp.stat(full);
      out.push({ name: e.name, size: st.size, mtime: st.mtimeMs, mime: mime.lookup(e.name) || "application/octet-stream" });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch { return []; }
}

const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const room = sanitizeRoom(req.params.room || req.body.room || "");
    if (!room) return cb(new Error("bad room"));
    await ensureRoom(room);
    cb(null, roomDir(room));
  },
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1) || "bin";
    cb(null, `${Date.now()}_${nanoid(6)}.${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_BYTES } });

app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const AGE_PREFIX = "age_ok_";
const ageCookie = (r) => AGE_PREFIX + r;

function shell(inner, title = "Rooms") {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--accent:#6366f1;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font-family:system-ui,Segoe UI,Roboto}
main{max-width:900px;margin:0 auto;padding:28px}
.card{background:var(--card);padding:18px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.35)}
h1,h2{margin:6px 0 12px} p{color:var(--mut)}
.btn{display:inline-block;padding:10px 14px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;border:none;cursor:pointer}
.btn:hover{opacity:.95}
.bad{background:var(--bad);color:#fff;border:none;border-radius:10px;padding:10px 14px;cursor:pointer}
.row{display:flex;gap:10px;flex-wrap:wrap}
.rooms{display:grid;gap:10px}
.roomrow{display:flex;align-items:center;gap:10px}
input[type=text],input[type=file],input[type=password]{flex:1;min-width:220px;padding:10px;border-radius:10px;border:1px solid #333;background:#0f1420;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:12px}
.tile{background:#0f1420;border:1px solid #1f2937;border-radius:12px;padding:10px}
.tile img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:#0b0c0f}
small{color:var(--mut)}
.center{display:flex;align-items:center;justify-content:center;min-height:40vh}
</style></head><body><main class="card">${inner}</main></body></html>`;
}

function homeView(rooms, admin) {
  return shell(`
    <h1>Rooms</h1>
    <div class="row">
      ${admin
        ? `<form method="post" action="/admin/logout"><button class="bad">Exit admin</button></form>
           <a class="btn" href="/manage">Manage</a>`
        : `<a class="btn" href="/admin">Admin</a>`}
    </div>
    <h2>Existing rooms</h2>
    <div class="rooms">
      ${rooms.length ? rooms.map(r => `<div class="roomrow"><a class="btn" href="/r/${r}">${r}</a></div>`).join("") : `<p><i>No rooms yet.</i></p>`}
    </div>
  `);
}

function manageView(rooms) {
  return shell(`
    <h1>Manage</h1>
    <a class="btn" href="/">Back</a>
    <form method="post" action="/admin/logout" style="display:inline"><button class="bad">Exit admin</button></form>
    <h2>Create room</h2>
    <form method="post" action="/create-room" class="row">
      <input type="text" name="room" placeholder="room-name (letters/numbers/dashes)" required pattern="[a-z0-9-]{1,40}">
      <button class="btn">Create</button>
    </form>
    <h2 style="margin-top:20px">Delete room</h2>
    ${rooms.map(r => `<form method="post" action="/delete-room/${r}" class="row"><input name="confirm" placeholder="type: ${r}" required><button class="bad">Delete ${r}</button></form>`).join("") || "<p><i>No rooms.</i></p>"}
  `);
}

function adminView(err = "") {
  return shell(`
    <h1>Admin login</h1>
    ${err ? `<p style="color:#fca5a5">${escapeHtml(err)}</p>` : ""}
    <form method="post" action="/admin" class="row">
      <input type="password" name="pass" placeholder="Password" required>
      <button class="btn">Login</button>
      <a class="btn" href="/">Cancel</a>
    </form>
  `);
}

function ageView(room) {
  return shell(`
    <div class="center">
      <div>
        <h1>18+</h1>
        <p>You must confirm your age to enter <b>${escapeHtml(room)}</b>.</p>
        <form method="post" action="/age-ok/${encodeURIComponent(room)}">
          <button class="btn" type="submit">I am 18 or older</button>
        </form>
      </div>
    </div>
  `, "18+ Check");
}

function roomView(room, files, admin) {
  return shell(`
    <h1>Room: ${escapeHtml(room)}</h1>
    <form class="row" method="post" enctype="multipart/form-data" action="/upload/${encodeURIComponent(room)}">
      <input type="file" name="file" required>
      <button class="btn">Upload</button>
      <a class="btn" href="/">Rooms</a>
      ${admin ? `<a class="btn" href="/manage">Manage</a>` : ""}
    </form>
    <h2 style="margin-top:18px">Files</h2>
    <div class="grid">
      ${files.length ? files.map(f => fileTile(room, f, admin)).join("") : "<p><i>No files yet.</i></p>"}
    </div>
  `);
}

function fileTile(room, f, admin) {
  const isImg = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.mime);
  const src = `/file/${room}/${f.name}`;
  const dl = `/download/${room}/${f.name}`;
  const del = `/delete/${room}/${f.name}`;
  return `<div class="tile">
    ${isImg ? `<a href="${src}" target="_blank"><img src="${src}" alt=""></a>` : `<div style="height:140px;display:flex;align-items:center;justify-content:center;background:#0b0c0f;border-radius:8px"><small>${escapeHtml(f.mime)}</small></div>`}
    <div style="margin-top:8px"><small>${f.name} · ${(f.size / 1048576).toFixed(1)} MB</small></div>
    <div class="row" style="margin-top:8px">
      <a class="btn" href="${dl}">Download</a>
      ${admin ? `<form method="post" action="${del}" onsubmit="return confirm('Delete ${f.name}?')"><button class="bad">Delete</button></form>` : ""}
    </div>
  </div>`;
}

// ROUTES
app.get("/", async (req, res) => {
  const rooms = await listRooms();
  res.type("html").send(homeView(rooms, isAdminReq(req)));
});

app.get("/admin", (req, res) => {
  if (isAdminReq(req)) return res.redirect("/");
  res.type("html").send(adminView());
});
app.post("/admin", (req, res) => {
  const pass = (req.body?.pass || "").trim();
  if (pass !== ADMIN_PASS) return res.status(401).type("html").send(adminView("Wrong password"));
  setAdmin(res);
  res.redirect("/");
});
app.post("/admin/logout", (_req, res) => {
  clearAdmin(res);
  res.redirect("/");
});

app.get("/manage", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const rooms = await listRooms();
  res.type("html").send(manageView(rooms));
});

app.post("/create-room", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.body.room || "");
  if (!room) return res.status(400).send("bad room");
  await ensureRoom(room);
  res.redirect(`/r/${room}`);
});

app.get("/r/:room", async (req, res) => {
  const room = sanitizeRoom(req.params.room);
  if (!room || !fs.existsSync(roomDir(room))) return res.status(404).send("not found");
  const ok = req.cookies[ageCookie(room)] === "1";
  if (!ok) return res.type("html").send(ageView(room));
  const files = await listFiles(room);
  res.type("html").send(roomView(room, files, isAdminReq(req)));
});

app.post("/age-ok/:room", (req, res) => {
  const room = sanitizeRoom(req.params.room);
  res.cookie(ageCookie(room), "1", { httpOnly: false, sameSite: "Lax", maxAge: 365 * 24 * 3600 * 1000 });
  res.redirect(`/r/${room}`);
});

app.post("/upload/:room", upload.single("file"), (req, res) => {
  const room = sanitizeRoom(req.params.room);
  res.redirect(`/r/${room}`);
});

app.get("/file/:room/:name", (req, res) => {
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name);
  const full = path.join(roomDir(room), name);
  if (!fs.existsSync(full)) return res.status(404).send("not found");
  res.type(mime.lookup(full) || "application/octet-stream");
  fs.createReadStream(full).pipe(res);
});
app.get("/download/:room/:name", (req, res) => {
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name);
  res.download(path.join(roomDir(room), name));
});

app.post("/delete/:room/:name", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name);
  await fsp.unlink(path.join(roomDir(room), name)).catch(() => {});
  res.redirect(`/r/${room}`);
});
app.post("/delete-room/:room", async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const typed = (req.body?.confirm || "").trim();
  if (typed !== room) return res.status(400).send("confirmation mismatch");
  await fsp.rm(roomDir(room), { recursive: true, force: true });
  res.redirect("/manage");
});

// DEBUG clear age cookie
app.get("/debug/clear-age/:room", (req, res) => {
  const room = sanitizeRoom(req.params.room);
  res.clearCookie(ageCookie(room));
  res.send(`Cleared age cookie for ${room}. Now visit /r/${room}`);
});

await ensureBase();
app.listen(PORT, () => console.log("Rooms server on :" + PORT));
