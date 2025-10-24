// Rooms app with:
// - 18+ gate on every room visit (NO cookies). Admin skips the gate.
// - Per-room uploads + gallery (no login for visitors)
// - Per-file delete (admin only)
// - Per-room delete with confirmation (admin only)
// - Newest-first ordering, single-click upload (prevents rapid double-submits)
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
const DATA_DIR = path.join(__dirname, "data");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein";

// Ensure base data dir
fs.mkdirSync(DATA_DIR, { recursive: true });

// Multer storage per-room
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const room = req.params.room.toLowerCase();
    const roomDir = path.join(DATA_DIR, room);
    fs.mkdirSync(roomDir, { recursive: true });
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    cb(null, `${Date.now()}-${nanoid(6)}.${ext}`);
  },
});
const upload = multer({ storage });

// Helpers
const isAdmin = (req) => req.query.admin === ADMIN_PASS;
const listRooms = () =>
  fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

const listFiles = (room) => {
  const dir = path.join(DATA_DIR, room);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return {
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
};

const layout = (title, content) => `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
:root{
  --bg:#0b0c0f; --panel:#111827; --mut:#9ca3af; --fg:#e5e7eb; --accent:#4f46e5;
  --danger:#ef4444; --ok:#16a34a; --card:#0f172a; --link:#60a5fa;
}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
.wrap{max-width:980px;margin:28px auto;padding:0 16px}
.panel{background:var(--panel);padding:20px;border-radius:16px;box-shadow:0 10px 30px rgb(0 0 0 / .35)}
h1{margin:0 0 14px;font-size:28px}
h2{margin:22px 0 10px;font-size:18px;color:var(--mut)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.btn{background:#1f2937;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
.btn.primary{background:var(--accent)} .btn.ok{background:var(--ok)} .btn.danger{background:var(--danger)}
.btn.small{padding:6px 10px;font-size:14px}
.card{background:var(--card);padding:12px;border-radius:12px;box-shadow:0 6px 16px rgb(0 0 0 / .3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.meta{color:var(--mut);font-size:12px;margin:6px 0 0}
input[type="text"]{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e5e7eb}
input[type="file"]{padding:10px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e5e7eb}
hr{border:0;height:1px;background:#263244;margin:18px 0}
.note{color:#fbbf24}
.thumb{display:block;width:100%;height:160px;object-fit:cover;border-radius:8px;border:1px solid #1f2937;background:#0b1220}
.badge{display:inline-block;background:#111827;border:1px solid #374151;padding:2px 8px;border-radius:999px;color:#a5b4fc;font-size:12px}
</style>
<div class="wrap"><div class="panel">${content}</div></div>
<script>
// prevent double submit on Upload
document.addEventListener('click', (e)=>{
  const u = e.target.closest('[data-upload]');
  if(u){
    if(u.dataset.busy==='1'){ e.preventDefault(); return false; }
    u.dataset.busy='1';
    setTimeout(()=>{ u.dataset.busy=''; }, 2000);
  }
});
</script>
</html>`;

// -------- 18 GATE (no cookies) ----------
const gatePage = (room, targetUrl, admin) => layout(
  "Age Check",
  `
  <h1>Are you 18 or older?</h1>
  <p>You must confirm your age to enter <b>${room}</b>.</p>
  <div class="row" style="margin-top:14px">
    <a class="btn ok" href="${targetUrl}">Yes, enter</a>
    <a class="btn danger" href="/rooms">No</a>
  </div>
  ${admin ? `<p class="meta" style="margin-top:12px">Admin is exempt from age check.</p>` : ""}
`
);

// make a safe link that preserves admin if present
const roomEnterLink = (req, room) => {
  const p = new URLSearchParams();
  if (isAdmin(req)) p.set("admin", ADMIN_PASS);
  p.set("over18", "1");
  return `/room/${encodeURIComponent(room)}?${p.toString()}`;
};

// ---------- ROUTES ----------
app.get("/", (req, res) => res.redirect("/rooms"));

// Rooms list (no create/delete here; admin actions are separate UI)
app.get("/rooms", (req, res) => {
  const rooms = listRooms();
  const admin = isAdmin(req);
  const items = rooms.length
    ? rooms.map(
        (r) => `<div class="row" style="justify-content:space-between;align-items:center">
                  <div>
                    <a class="btn small" href="/room/${encodeURIComponent(r)}">Enter: ${r}</a>
                    ${admin ? `<a class="btn small" href="/admin/file-tools/${encodeURIComponent(r)}?admin=${ADMIN_PASS}">Files</a>` : ""}
                  </div>
                  ${admin ? `<a class="btn danger small" href="/admin/delete-room/${encodeURIComponent(r)}?admin=${ADMIN_PASS}">Delete room</a>` : ""}
                </div>`
      ).join("<hr>")
    : `<p class="meta">No rooms yet.</p>`;

  const adminControls = admin
    ? `<hr>
       <h2>Admin</h2>
       <form class="row" action="/admin/create-room" method="post">
         <input type="hidden" name="admin" value="${ADMIN_PASS}"/>
         <input name="room" type="text" placeholder="room-name (lowercase/numbers/dashes, max 40)"/>
         <button class="btn primary">Create room</button>
       </form>
       <p class="meta">You are in admin mode. <a class="badge" href="/rooms">Exit admin</a></p>`
    : `<p class="meta">(This page lists rooms only. Room creation/deletion isn’t exposed here.)</p>
       <a class="btn" href="/admin?admin=${ADMIN_PASS}">Admin</a>`;

  res.send(
    layout(
      "Rooms",
      `<h1>Rooms</h1>${adminControls}<hr><h2>Existing rooms</h2>${items}`
    )
  );
});

// Enter admin (simple: query must match)
app.get("/admin", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/rooms");
  res.redirect(`/rooms?admin=${ADMIN_PASS}`);
});

app.use(express.urlencoded({ extended: true }));

// Admin: create room
app.post("/admin/create-room", (req, res) => {
  if (req.body.admin !== ADMIN_PASS) return res.redirect("/rooms");
  let room = (req.body.room || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(room)) {
    return res.send(layout("Invalid room", `<h1>Invalid room name</h1><a class="btn" href="/rooms?admin=${ADMIN_PASS}">Back</a>`));
  }
  const dir = path.join(DATA_DIR, room);
  fs.mkdirSync(dir, { recursive: true });
  res.redirect(`/rooms?admin=${ADMIN_PASS}`);
});

// Admin: delete room (asks to type room to confirm)
app.get("/admin/delete-room/:room", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/rooms");
  const room = req.params.room;
  res.send(
    layout(
      "Delete Room",
      `<h1>Delete room: ${room}</h1>
       <p class="note">This permanently deletes all files in this room.</p>
       <form method="post" action="/admin/delete-room/${encodeURIComponent(room)}">
         <input type="hidden" name="admin" value="${ADMIN_PASS}"/>
         <p>Type the room name to confirm:</p>
         <input type="text" name="confirm" placeholder="${room}"/>
         <div class="row" style="margin-top:12px">
           <button class="btn danger">Delete room</button>
           <a class="btn" href="/rooms?admin=${ADMIN_PASS}">Cancel</a>
         </div>
       </form>`
    )
  );
});
app.post("/admin/delete-room/:room", (req, res) => {
  if (req.body.admin !== ADMIN_PASS) return res.redirect("/rooms");
  const room = req.params.room;
  if ((req.body.confirm || "").trim() !== room) {
    return res.send(layout("Confirm mismatch", `<h1>Confirmation didn’t match.</h1><a class="btn" href="/rooms?admin=${ADMIN_PASS}">Back</a>`));
  }
  const dir = path.join(DATA_DIR, room);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  res.redirect(`/rooms?admin=${ADMIN_PASS}`);
});

// 18 gate middleware (NO cookies)
// If not admin and no ?over18=1, show the gate page for that room.
const requireOver18 = (req, res, next) => {
  const room = req.params.room;
  if (isAdmin(req)) return next(); // admin skips gate
  if (req.query.over18 === "1") return next();
  const target = roomEnterLink(req, room);
  return res.status(200).send(gatePage(room, target, false));
};

// Room view
app.get("/room/:room", requireOver18, (req, res) => {
  const room = (req.params.room || "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(room)) return res.redirect("/rooms");

  const files = listFiles(room);
  const admin = isAdmin(req);

  const fileCards = files
    .map((f) => {
      const enc = encodeURIComponent(f.name);
      const img = `/file/${encodeURIComponent(room)}/${enc}`;
      const delBtn = admin
        ? `<a class="btn danger small" href="/delete/${encodeURIComponent(room)}/${enc}?admin=${ADMIN_PASS}" onclick="return confirm('Delete ${f.name}?')">Delete</a>`
        : "";
      return `<div class="card">
        <img class="thumb" src="${img}" alt="${f.name}"/>
        <div class="meta">${f.name}</div>
        <div class="row" style="margin-top:8px">
          <a class="btn small" href="${img}" download>Download</a>
          ${delBtn}
        </div>
      </div>`;
    })
    .join("");

  const adminBadge = admin
    ? `<a class="btn" href="/rooms?admin=${ADMIN_PASS}">Rooms</a>
       <a class="btn danger" href="/rooms">Exit admin</a>`
    : `<a class="btn" href="/rooms">Rooms</a>
       <a class="btn" href="/admin?admin=${ADMIN_PASS}">Admin</a>`;

  res.send(
    layout(
      `Room: ${room}`,
      `<h1>Room: ${room}</h1>
       <div class="row" style="margin-bottom:12px">${adminBadge}</div>
       <form class="row" action="/upload/${encodeURIComponent(room)}" method="post" enctype="multipart/form-data">
         ${admin ? `<input type="hidden" name="admin" value="${ADMIN_PASS}"/>` : ""}
         <input name="file" type="file" required/>
         <button class="btn primary" data-upload>Upload</button>
       </form>
       <hr/>
       <div class="grid">${fileCards || '<div class="meta">No files yet.</div>'}</div>`
    )
  );
});

// File serve
app.get("/file/:room/:name", (req, res) => {
  const file = path.join(DATA_DIR, req.params.room, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).send("Not found");
  res.sendFile(file);
});

// Upload (any visitor can upload)
app.post("/upload/:room", upload.single("file"), (req, res) => {
  const room = req.params.room.toLowerCase();
  const params = new URLSearchParams();
  if (req.body.admin === ADMIN_PASS) params.set("admin", ADMIN_PASS);
  // Important: force over18=1 in redirect so user lands back in the room after upload
  params.set("over18", "1");
  res.redirect(`/room/${encodeURIComponent(room)}?${params.toString()}`);
});

// Per-file delete (admin only)
app.get("/delete/:room/:name", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/rooms");
  const file = path.join(DATA_DIR, req.params.room, req.params.name);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  res.redirect(`/room/${encodeURIComponent(req.params.room)}?admin=${ADMIN_PASS}&over18=1`);
});

// Simple admin “file tools” link (read-only listing with delete links already available in room)
app.get("/admin/file-tools/:room", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/rooms");
  const room = req.params.room;
  res.redirect(`/room/${encodeURIComponent(room)}?admin=${ADMIN_PASS}&over18=1`);
});

// 404
app.use((req, res) => res.status(404).send(layout("Not Found", `<h1>Not Found</h1><a class="btn" href="/rooms">Rooms</a>`)));

app.listen(PORT, () => console.log(`Up on :${PORT}`));
