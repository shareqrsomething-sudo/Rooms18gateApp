// Rooms app with:
// - 18+ gate on every room
// - Per-room uploads + gallery (no login for visitors)
// - Admin delete via password (?admin=PASS reveals delete links)
// - Mobile-friendly single-file server

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

// ====== CONFIG ======
const DATA_DIR = path.join(__dirname, "uploads");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein";
const MAX_MB = Number(process.env.MAX_MB || 50);

// ensure uploads dir exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ====== HELPERS ======
function roomDir(room) {
  const safe = String(room).trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
  const dir = path.join(DATA_DIR, safe || "room");
  fs.mkdirSync(dir, { recursive: true });
  return { safe, dir };
}

function listFiles(dir) {
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isFile()) {
      const size = stat.size;
      const type = mime.lookup(name) || "application/octet-stream";
      items.push({ name, size, type, mtime: stat.mtimeMs });
    }
  }
  // newest first
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

function human(bytes) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${u[i]}`;
}

// ====== MULTER (per-room destination) ======
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { dir } = roomDir(req.params.room || req.body.room || "room");
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || mime.extension(file.mimetype) || "";
    const base = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^\w\-]+/g, "-");
    cb(null, `${base}-${nanoid(6)}${ext ? "." + ext.replace(/^\./, "") : ""}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// ====== STATIC SERVE FOR UPLOADS ======
app.use("/u", express.static(DATA_DIR, { fallthrough: false }));

// ====== HTML SHARED PIECES ======
const CSS = `
:root{--bg:#0b0c0f;--card:#111827;--mut:#9ca3af;--fg:#e5e7eb;--btn:#2563eb;--ok:#16a34a;--warn:#f59e0b;--bad:#dc2626}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px system-ui,Segoe UI,Roboto,Arial}
.card{width:min(92vw,980px);background:var(--card);border:1px solid #1f2937;border-radius:16px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
h1{margin:0 0 8px;font-size:28px}p{margin:0 0 14px;color:var(--mut)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}
.btn{padding:10px 14px;border-radius:10px;border:1px solid #2b3443;background:#111827;color:#e5e7eb;text-decoration:none}
.btn.ok{background:var(--ok);border-color:#1a9b45}
.btn.warn{background:var(--warn);border-color:#d1870a;color:#111}
.btn.bad{background:var(--bad);border-color:#b71c1c}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
.item{background:#0f1624;border:1px solid #1f2937;border-radius:12px;padding:8px}
.item .name{font-size:12px;opacity:.9;word-break:break-word}
.item .meta{font-size:11px;color:var(--mut)}
.thumb{width:100%;height:120px;object-fit:cover;border-radius:8px;display:block;background:#090f1a}
.hide{display:none}
.notice{color:#fbbf24;margin-top:10px}
`;

function page({ title, body, scripts = "" }) {
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${CSS}</style>
</head><body>${body}${scripts}</body></html>`;
}

// ====== AGE GATE + ROOM VIEW ======
app.get("/", (req, res) => {
  res.redirect("/room/general");
});

app.get("/room/:room", (req, res) => {
  const { safe, dir } = roomDir(req.params.room);
  const files = listFiles(dir);
  const admin = (req.query.admin || "") === ADMIN_PASS;

  const gallery = files
    .map((f) => {
      const isImg = String(f.type).startsWith("image/");
      const href = `/u/${safe}/${encodeURIComponent(f.name)}`;
      const thumb = isImg
        ? `<img class="thumb" src="${href}" alt="">`
        : `<div class="thumb" style="display:grid;place-items:center;font-size:40px;opacity:.6">📄</div>`;

      const del = admin
        ? `<a class="btn bad" href="/delete/${encodeURIComponent(safe)}/${encodeURIComponent(f.name)}?admin=${encodeURIComponent(
            ADMIN_PASS
          )}" onclick="return confirm('Delete ${f.name}?')">Delete</a>`
        : "";

      return `<div class="item">
        <a href="${href}" target="_blank">${thumb}</a>
        <div class="name">${f.name}</div>
        <div class="meta">${f.type} • ${human(f.size)}</div>
        <div class="row">${del}<a class="btn" href="${href}" download>Download</a></div>
      </div>`;
    })
    .join("");

  const body = `
  <div class="card">
    <h1>Room: ${safe}</h1>
    <p>Upload and view files for this room. <span class="notice">Admin can append <code>?admin=${ADMIN_PASS}</code> to the URL to reveal delete buttons.</span></p>

    <div id="gate">
      <div class="row">
        <a class="btn ok" href="#" id="yes">Yes, I’m 18+</a>
        <a class="btn bad" href="#" id="no">No</a>
      </div>
      <p class="notice">You must confirm your age to continue.</p>
    </div>

    <div id="content" class="hide">
      <form class="row" action="/upload/${safe}" method="post" enctype="multipart/form-data">
        <input class="btn" type="file" name="file" required>
        <button class="btn ok" type="submit">Upload</button>
        <a class="btn" href="/room/${safe}">Refresh</a>
      </form>

      <div class="grid" style="margin-top:12px">${gallery || "<p>No files yet.</p>"}</div>
    </div>
  </div>`;

  const scripts = `
  <script>
    const gate = document.getElementById('gate');
    const content = document.getElementById('content');
    const key = 'age_ok';
    const ok = sessionStorage.getItem(key) === '1';
    function show() { gate.classList.add('hide'); content.classList.remove('hide'); }
    function hide(){ gate.classList.remove('hide'); content.classList.add('hide'); }
    if (ok) show();
    document.getElementById('yes').onclick = (e)=>{ e.preventDefault(); sessionStorage.setItem(key,'1'); show(); };
    document.getElementById('no').onclick  = (e)=>{ e.preventDefault(); alert('You must be 18 or older.'); hide(); };
  </script>`;

  res.send(page({ title: `Room ${safe}`, body, scripts }));
});

// ====== UPLOAD ======
app.post("/upload/:room", upload.single("file"), (req, res) => {
  const room = req.params.room;
  res.redirect(`/room/${encodeURIComponent(room)}`);
});

// ====== DELETE (admin) ======
app.get("/delete/:room/:name", (req, res) => {
  if ((req.query.admin || "") !== ADMIN_PASS) return res.status(403).send("Forbidden");
  const room = String(req.params.room);
  const name = String(req.params.name);
  const { dir } = roomDir(room);
  const target = path.join(dir, name);
  try {
    fs.unlinkSync(target);
  } catch {}
  res.redirect(`/room/${encodeURIComponent(room)}?admin=${encodeURIComponent(ADMIN_PASS)}`);
});

// ====== HEALTH ======
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ====== START ======
app.listen(PORT, () => {
  console.log("Rooms server listening on", PORT);
});
