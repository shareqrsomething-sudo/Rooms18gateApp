// Rooms app with:
// • 18+ gate on every room
// • Per-room uploads + gallery (no login for visitors)
// • Admin delete via password (button prompts; no URL tricks)
// • Free & self-contained

import fs from "fs";
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
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein"; // change on Render > Environment
const UPLOAD_DIR = path.join(__dirname, "uploads");

app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/static", express.static(path.join(__dirname, "static")));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ----- storage (per-room folder) -----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const room = (req.params.room || "general").toLowerCase();
    const dir = path.join(UPLOAD_DIR, room);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    cb(null, `${Date.now()}_${nanoid(6)}.${ext}`);
  }
});
const upload = multer({ storage });

// ----- helpers -----
const isAdminReq = (req) => req.cookies && req.cookies.admin === "1";

const listFiles = (room) => {
  const dir = path.join(UPLOAD_DIR, room);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    return {
      name,
      size: s.size,
      mtime: s.mtimeMs,
      type: mime.lookup(p) || "application/octet-stream",
      url: `/uploads/${encodeURIComponent(room)}/${encodeURIComponent(name)}`
    };
  }).sort((a,b)=>b.mtime - a.mtime);
};

// ----- 18+ gate middleware -----
app.use((req, res, next) => {
  // simple sessionStorage check happens in the client HTML
  next();
});

// ----- Admin login/logout (no URL params) -----
app.post("/admin", (req, res) => {
  const { pass } = req.body || {};
  if (pass === ADMIN_PASS) {
    // cookie lasts 1 day
    res.cookie("admin", "1", { httpOnly: true, sameSite: "lax", maxAge: 24*60*60*1000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, msg: "wrong-password" });
});

app.post("/admin/logout", (req, res) => {
  res.clearCookie("admin");
  res.json({ ok: true });
});

// ----- Rooms -----
app.get("/", (req, res) => res.redirect("/room/general"));

app.get("/room/:room", (req, res) => {
  const room = (req.params.room || "general").toLowerCase();
  const files = listFiles(room);
  const admin = isAdminReq(req);

  const html = /*html*/`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Room: ${room}</title>
  <style>
    :root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--u:#4f46e5;--ok:#16a34a;--warn:#f59e0b;--bad:#ef4444}
    body{margin:0;display:grid;min-height:100vh;place-items:start;background:var(--bg);color:var(--fg);font-family:system-ui,Segoe UI,Roboto,Ubuntu,Arial}
    .wrap{max-width:900px;width:96vw;margin:24px auto}
    .card{background:var(--card);border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{margin:0 0 16px;font-size:28px}
    p{margin:0 0 10px;color:var(--mut)}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
    button,.btn,input[type=file]{background:#374151;color:#fff;border:1px solid #4b5563;border-radius:10px;padding:12px 14px;cursor:pointer}
    .ok{background:var(--ok);border-color:#15803d}
    .bad{background:var(--bad);border-color:#b91c1c}
    .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:16px}
    .tile{background:#0f172a;border-radius:12px;padding:12px;border:1px solid #1f2937}
    .tile img{display:block;width:100%;height:150px;object-fit:cover;border-radius:8px}
    .meta{font-size:12px;color:var(--mut);margin:6px 0 10px}
    .hide{display:none}
    /* Age gate */
    #ageGate{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center}
    #ageGate .card{max-width:520px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Room: ${room}</h1>
      <p>Upload and view files for this room.</p>

      <div class="row">
        <input id="f" type="file" />
        <button id="up" class="ok">Upload</button>
        <button id="ref">Refresh</button>
        <span style="flex:1"></span>
        <button id="adminBtn">Admin</button>
        <button id="logoutBtn" class="bad ${admin ? "" : "hide"}">Exit admin</button>
      </div>

      <div id="warn" class="hide" style="color:#fbbf24;margin:8px 0">Uploading…</div>

      <div id="list" class="thumbs">
        ${files.map(f => `
          <div class="tile">
            ${f.type.startsWith("image/")
              ? `<img src="${f.url}" alt="${f.name}">`
              : `<div style="height:150px;display:grid;place-items:center;border:1px dashed #334155;border-radius:8px;">${f.type}</div>`}
            <div class="meta">${f.name} · ${Math.ceil(f.size/1024)} KB</div>
            <div class="row">
              <a class="btn" href="${f.url}" download>Download</a>
              ${admin ? `<button class="btn bad del" data-name="${encodeURIComponent(f.name)}">Delete</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>

    </div>
  </div>

  <div id="ageGate" class="card">
    <div class="card">
      <h1>18+</h1>
      <p>You must be of legal age to access this content.</p>
      <div class="row">
        <button id="yes" class="ok">Yes</button>
        <button id="no" class="bad">No</button>
      </div>
    </div>
  </div>

<script>
  const room = ${JSON.stringify(room)};
  const adminOn = ${admin ? "true" : "false"};

  // 18+ gate using sessionStorage
  const gate = document.getElementById('ageGate');
  if (sessionStorage.getItem('age-ok') === '1') gate.style.display = 'none';
  document.getElementById('yes').onclick = () => { sessionStorage.setItem('age-ok','1'); gate.style.display='none'; };
  document.getElementById('no').onclick = () => { location.href = 'https://www.google.com'; };

  // Upload
  const f = document.getElementById('f');
  document.getElementById('up').onclick = async () => {
    if (!f.files || !f.files[0]) return alert('Pick a file first.');
    document.getElementById('warn').classList.remove('hide');
    const fd = new FormData();
    fd.append('file', f.files[0]);
    const r = await fetch('/upload/' + encodeURIComponent(room), { method: 'POST', body: fd });
    document.getElementById('warn').classList.add('hide');
    if (!r.ok) return alert('Upload failed');
    location.reload();
  };
  document.getElementById('ref').onclick = () => location.reload();

  // Delete (admin only)
  document.querySelectorAll('.del').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this file?')) return;
      const name = btn.dataset.name;
      const r = await fetch('/delete/' + encodeURIComponent(room) + '/' + name, { method: 'POST' });
      if (!r.ok) return alert('Delete failed');
      location.reload();
    };
  });

  // Admin login (no URL changes)
  const adminBtn = document.getElementById('adminBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  if (adminOn) adminBtn.classList.add('hide');
  adminBtn.onclick = async () => {
    const pass = prompt('Admin password');
    if (!pass) return;
    const r = await fetch('/admin', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pass })});
    if (r.ok) location.reload(); else alert('Wrong password');
  };
  logoutBtn.onclick = async () => {
    await fetch('/admin/logout', { method:'POST' });
    location.reload();
  };
</script>
</body>
</html>`;
  res.type("html").send(html);
});

// Upload
app.post("/upload/:room", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok:false, msg:"no-file" });
  res.json({ ok:true });
});

// Delete (admin only)
app.post("/delete/:room/:name", (req, res) => {
  if (!isAdminReq(req)) return res.status(401).json({ ok:false, msg:"admin-required" });
  const room = req.params.room.toLowerCase();
  const file = req.params.name;
  const p = path.join(UPLOAD_DIR, room, file);
  if (!p.startsWith(path.join(UPLOAD_DIR, room))) return res.status(400).json({ ok:false });
  try { fs.unlinkSync(p); } catch { /* ignore */ }
  res.json({ ok:true });
});

app.listen(PORT, () => {
  console.log("Rooms app listening on", PORT);
});
