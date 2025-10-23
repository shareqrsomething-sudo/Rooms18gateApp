// Rooms app with:
// • 18+ gate on every room
// • Per-room uploads + gallery (no login for visitors)
// • Admin delete via password (query ?admin=PASS shows delete links)
// • Mobile-friendly single-file server

import fs from "fs";
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
const ADMIN_PASS = process.env.ADMIN_PASS || "changeme"; // set in Render → Environment

const UPLOAD_ROOT = path.join(__dirname, "uploads");

// ensure base uploads dir exists
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// dynamic per-room storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const room = (req.params.room || "lobby").toLowerCase();
    const dir = path.join(UPLOAD_ROOT, room);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    cb(null, `${Date.now()}-${nanoid(6)}.${ext}`);
  }
});
const upload = multer({ storage });

// serve uploaded files
app.use("/uploads", express.static(UPLOAD_ROOT, {
  fallthrough: true,
  setHeaders: (res) => {
    // allow direct open in browser
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
}));

// helper: read files for a room
function listFiles(room) {
  const dir = path.join(UPLOAD_ROOT, room);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .map(f => ({
      name: f,
      url: `/uploads/${encodeURIComponent(room)}/${encodeURIComponent(f)}`
    }))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first by filename prefix
}

// 18 gate + gallery page (every room)
app.get("/:room?", (req, res) => {
  const room = (req.params.room || "lobby").toLowerCase();
  const admin = req.query.admin === ADMIN_PASS;
  const files = listFiles(room);

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${room} • Rooms18Gate</title>
<style>
:root{
  --bg:#0b0c0f; --card:#111827; --mut:#9ca3af; --fg:#e5e7eb; --accent:#22c55e; --danger:#ef4444; --btn:#374151;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";min-height:100svh;display:grid;place-items:center;padding:18px;}
.container{width:min(980px,100%);}
h1{margin:0 0 10px;font-size:26px}
.row{display:flex;flex-wrap:wrap;gap:10px}
.card{background:var(--card);border-radius:14px;padding:14px}
.toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px}
input[type=file]{max-width:100%}
button,a.btn{appearance:none;border:0;border-radius:10px;padding:10px 14px;background:var(--btn);color:#fff;text-decoration:none}
button.upload{background:var(--accent)}
a.delete{background:var(--danger)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.item{background:#0f172a;border-radius:12px;overflow:hidden}
.item a{display:block;color:#cbd5e1;text-decoration:none;padding:8px;font-size:12px;word-break:break-all}
.item img{display:block;width:100%;height:120px;object-fit:cover;background:#111}
.badge{padding:6px 10px;border-radius:999px;background:#1f2937;color:#9ca3af;font-size:12px}
.warn{color:#fbbf24;font-size:13px}
#gate{position:fixed;inset:0;background:rgba(0,0,0,.72);display:grid;place-items:center}
.gatebox{background:#0d1117;border:1px solid #222;border-radius:14px;padding:18px;width:min(520px,92vw);text-align:center}
.gatebox h2{margin:0 0 8px}
.grow{flex:1}
.small{font-size:12px;color:#9ca3af}
</style>

<div class="container">
  <div class="card">
    <div class="toolbar">
      <div class="row">
        <span class="badge">Room: <b>${room}</b></span>
        ${admin ? '<span class="badge">Admin</span>' : ''}
      </div>
      <a class="btn" href="/lobby">Lobby</a>
    </div>

    <form class="row" method="post" action="/upload/${encodeURIComponent(room)}" enctype="multipart/form-data">
      <input class="grow" type="file" name="file" required>
      <button class="upload">Upload</button>
    </form>

    <p class="small">Share this room: <code>${req.protocol}://${req.get("host")}/${room}</code></p>

    ${files.length ? '<div class="grid">' + files.map(f=>{
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
      const thumb = isImage ? `<img loading="lazy" src="${f.url}">` : '';
      const del = admin ? \`<a class="btn delete" href="/delete/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}?admin=${encodeURIComponent(ADMIN_PASS)}" onclick="return confirm('Delete \${f.name}?')">Delete</a>\` : '';
      return \`<div class="item">\${thumb}<a href="\${f.url}" target="_blank">\${f.name}</a>\${del}</div>\`;
    }).join('') + '</div>' : '<p class="warn">No files yet — be the first to upload.</p>'}
  </div>

  <p class="small">Tip: Append <code>?admin=${ADMIN_PASS}</code> to this URL to show delete buttons.</p>
</div>

<div id="gate">
  <div class="gatebox">
    <h2>18+</h2>
    <p>You must be of legal age to access this room.</p>
    <div class="row" style="justify-content:center;margin-top:8px">
      <button id="yes" class="upload">Yes, I am 18 or older</button>
      <a id="no" class="btn" href="https://google.com">No</a>
    </div>
    <p class="small" style="margin-top:10px;opacity:.8">Your choice is remembered for this session.</p>
  </div>
</div>

<script>
  // Simple session-only 18+ gate
  (function () {
    try {
      if (sessionStorage.getItem('age18') === 'yes') {
        document.getElementById('gate').style.display = 'none';
      }
      document.getElementById('yes').onclick = function () {
        sessionStorage.setItem('age18', 'yes');
        document.getElementById('gate').style.display = 'none';
      };
    } catch(e) {}
  })();
</script>
`;
  res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' data: blob: https:;");
  res.send(html);
});

// handle uploads (per-room)
app.post("/upload/:room", upload.single("file"), (req, res) => {
  const room = (req.params.room || "lobby").toLowerCase();
  res.redirect(`/${encodeURIComponent(room)}`);
});

// admin delete
app.get("/delete/:room/:file", (req, res) => {
  const { room, file } = req.params;
  if (req.query.admin !== ADMIN_PASS) return res.status(403).send("Forbidden");
  const target = path.join(UPLOAD_ROOT, room, file);
  try {
    fs.unlinkSync(target);
  } catch (e) {
    // ignore
  }
  res.redirect(`/${encodeURIComponent(room)}?admin=${encodeURIComponent(ADMIN_PASS)}`);
});

// health check
app.get("/healthz", (_req, res) => res.send("ok"));

// default: redirect to lobby
app.get("/", (_req, res) => res.redirect("/lobby"));

app.listen(PORT, () => {
  console.log("rooms18gate listening on", PORT);
});
