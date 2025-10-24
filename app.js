// Rooms18gate — landing page has NO Create; admin tools live at /manage
//  - 18+ gate per room (cookie) always enforced
//  - Landing "/" lists rooms only + Admin or Exit buttons (no create here ever)
//  - /manage (admin only): create & delete rooms
//  - Upload/view for everyone; delete file/room admin-only

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
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 10000;

// --- config ---
const DATA_DIR    = path.join(__dirname, "data");
const ADMIN_PASS  = process.env.ADMIN_PASS || "letmein";
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || "25", 10);
const MAX_FILE    = MAX_FILE_MB * 1024 * 1024;

// --- utils ---
const roomDir = (r) => path.join(DATA_DIR, r);
const sanitizeRoom = (s) => {
  if (typeof s !== "string") return "";
  const t = s.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(t) ? t : "";
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const isAdminReq = (req) => req.cookies?.admin === "1";
const setAdmin   = (res) => res.cookie("admin","1",{ httpOnly:true, sameSite:"Lax", maxAge:24*3600e3 });
const clearAdmin = (res) => res.clearCookie("admin");

async function ensureBase(){ await fsp.mkdir(DATA_DIR,{recursive:true}); }
async function ensureRoom(r){ await ensureBase(); await fsp.mkdir(roomDir(r),{recursive:true}); }
async function listRooms(){
  await ensureBase();
  const ents = await fsp.readdir(DATA_DIR,{withFileTypes:true});
  return ents.filter(e=>e.isDirectory()).map(e=>e.name).sort();
}
async function listFiles(room){
  try{
    const ents = await fsp.readdir(roomDir(room),{withFileTypes:true});
    const out=[];
    for(const e of ents){
      if(!e.isFile()) continue;
      const full = path.join(roomDir(room), e.name);
      const st   = await fsp.stat(full);
      out.push({ name:e.name, size:st.size, mtime:st.mtimeMs, mime:mime.lookup(e.name)||"application/octet-stream" });
    }
    out.sort((a,b)=>b.mtime-a.mtime);
    return out;
  }catch{ return []; }
}

// --- storage ---
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const room = sanitizeRoom(req.params.room || req.body.room || "");
    if(!room) return cb(new Error("bad room"));
    await ensureRoom(room);
    cb(null, roomDir(room));
  },
  filename: (_req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1) || "bin";
    cb(null, `${Date.now()}_${nanoid(6)}.${ext}`);
  }
});
const upload = multer({ storage, limits:{ fileSize: MAX_FILE } });

// --- middleware ---
app.use(cookieParser());
app.use(express.urlencoded({extended:false}));
app.use(express.json());

// --- age gate ---
const AGE_PREFIX = "age_ok_";
const ageCookie  = (room) => AGE_PREFIX + room;

// --- view shell ---
function shell(inner, title="Rooms"){
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
.inline{display:inline-block;margin-left:8px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.rooms{display:grid;gap:10px}
.roomrow{display:flex;align-items:center;gap:10px}
input[type=text],input[type=file],input[type=password]{flex:1;min-width:220px;padding:10px;border-radius:10px;border:1px solid #333;background:#0f1420;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:12px}
.tile{background:#0f1420;border:1px solid #1f2937;border-radius:12px;padding:10px}
.tile img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:#0b0c0f}
small{color:var(--mut)}
.center{display:flex;align-items:center;justify-content:center;min-height:40vh}
</style></head><body><main class="card">
${inner}
</main></body></html>`;
}

// --- pages ---
function homeView(rooms, admin){
  // NOTE: NO create form here anymore (even for admin)
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
      ${rooms.length ? rooms.map(r => `
        <div class="roomrow">
          <a class="btn" href="/r/${encodeURIComponent(r)}">${escapeHtml(r)}</a>
        </div>`).join("") : `<p><i>No rooms yet.</i></p>`}
    </div>
  `,"Rooms");
}

function manageView(rooms){
  return shell(`
    <h1>Manage</h1>
    <div class="row">
      <a class="btn" href="/">Back</a>
      <form method="post" action="/admin/logout"><button class="bad">Exit admin</button></form>
    </div>

    <h2 style="margin-top:16px">Create room</h2>
    <form method="post" action="/create-room" class="row">
      <input type="text" name="room" placeholder="room-name (letters/numbers/dashes)" required pattern="[a-z0-9-]{1,40}">
      <button class="btn">Create</button>
    </form>
    <p><small>Lowercase letters, numbers, dashes; max 40 chars.</small></p>

    <h2 style="margin-top:22px">Delete room</h2>
    ${rooms.length ? rooms.map(r => `
      <form method="post" action="/delete-room/${encodeURIComponent(r)}" class="row"
            onsubmit="return confirm('Delete room &quot;${escapeHtml(r)}&quot; and ALL files?')">
        <input type="text" name="confirm" placeholder="type: ${r}" required>
        <button class="bad">Delete ${escapeHtml(r)}</button>
      </form>
    `).join("") : `<p><i>No rooms to delete.</i></p>`}
  `,"Manage");
}

function adminView(error=""){
  return shell(`
    <h1>Admin login</h1>
    ${error ? `<p style="color:#fca5a5">${escapeHtml(error)}</p>` : ``}
    <form method="post" action="/admin" class="row">
      <input type="password" name="pass" placeholder="Password" required>
      <button class="btn" type="submit">Login</button>
      <a class="btn" href="/">Cancel</a>
    </form>
  `,"Admin");
}

function ageView(room){
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
  `,"18+ Check");
}

function roomView(room, files, admin){
  return shell(`
    <h1>Room: ${escapeHtml(room)}</h1>
    <p>Upload and view files for this room.</p>

    <form class="row" method="post" enctype="multipart/form-data" action="/upload/${encodeURIComponent(room)}">
      <input type="file" name="file" required>
      <button class="btn" type="submit">Upload</button>
      <a class="btn" href="/">Rooms</a>
      ${admin ? `<a class="btn" href="/manage">Manage</a>` : ``}
    </form>

    ${admin ? `
      <h2 style="margin-top:18px">Danger zone</h2>
      <form class="row" id="delRoomForm" method="post" action="/delete-room/${encodeURIComponent(room)}">
        <input type="text" name="confirm" id="confirmRoom" placeholder="type: ${room}" required>
        <button class="bad" id="delRoomBtn" type="submit" disabled>Delete Room</button>
      </form>
      <script>
        (()=>{
          const inp=document.getElementById('confirmRoom');
          const btn=document.getElementById('delRoomBtn');
          const must='${room}';
          const enable=()=>{ btn.disabled = (inp.value.trim() !== must); };
          inp.addEventListener('input', enable); enable();
          document.getElementById('delRoomForm').addEventListener('submit',(e)=>{
            if(inp.value.trim() !== must){ e.preventDefault(); alert('Please type the room name exactly.'); }
            else if(!confirm('Delete room "'+must+'" and ALL its files?')){ e.preventDefault(); }
          });
        })();
      </script>
    ` : ``}

    <h2 style="margin-top:18px">Files</h2>
    <div class="grid">
      ${files.length ? files.map(f => fileTile(room,f,admin)).join("") : `<p><i>No files yet.</i></p>`}
    </div>
  `,`Room: ${room}`);
}

function fileTile(room,f,admin){
  const imgTypes=["image/jpeg","image/png","image/webp","image/gif","image/avif"];
  const isImg = imgTypes.includes(f.mime);
  const src = `/file/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}`;
  const dl  = `/download/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}`;
  const del = `/delete/${encodeURIComponent(room)}/${encodeURIComponent(f.name)}`;
  return `<div class="tile">
    ${isImg ? `<a href="${src}" target="_blank"><img src="${src}" alt=""></a>`
            : `<div style="height:140px;display:flex;align-items:center;justify-content:center;background:#0b0c0f;border-radius:8px"><small>${escapeHtml(f.mime)}</small></div>`}
    <div style="margin-top:8px"><small>${escapeHtml(f.name)} · ${(f.size/1048576).toFixed(1)} MB</small></div>
    <div class="row" style="margin-top:8px">
      <a class="btn" href="${dl}">Download</a>
      ${admin ? `<form method="post" action="${del}" onsubmit="return confirm('Delete ${escapeHtml(f.name)}?')"><button class="bad">Delete</button></form>` : ``}
    </div>
  </div>`;
}

// --- routes ---

// Home: list rooms only (NO create here)
app.get("/", async (req,res)=>{
  const rooms = await listRooms();
  res.type("html").send(homeView(rooms, isAdminReq(req)));
});

// Manage (admin only)
app.get("/manage", async (req,res)=>{
  if(!isAdminReq(req)) return res.status(403).send("admin only");
  const rooms = await listRooms();
  res.type("html").send(manageView(rooms));
});

// Admin login/logout
app.get("/admin", (req,res)=>{
  if(isAdminReq(req)) return res.redirect("/");
  res.type("html").send(adminView());
});
app.post("/admin", (req,res)=>{
  const pass = (req.body?.pass || "").trim();
  if(pass !== ADMIN_PASS) return res.status(401).type("html").send(adminView("Wrong password"));
  setAdmin(res); res.redirect("/");
});
app.post("/admin/logout", (_req,res)=>{ clearAdmin(res); res.redirect("/"); });

// Create room (admin only, and not on landing page)
app.post("/create-room", async (req,res)=>{
  if(!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.body.room || "");
  if(!room) return res.status(400).send("bad room");
  await ensureRoom(room);
  res.redirect(`/r/${encodeURIComponent(room)}`);
});

// Room page with mandatory 18+ gate
app.get("/r/:room", async (req,res)=>{
  const room = sanitizeRoom(req.params.room);
  if(!room) return res.status(404).send("room not found");
  if(!fs.existsSync(roomDir(room))) return res.status(404).send("room not found");

  const ok = req.cookies[ageCookie(room)] === "1";
  if(!ok) return res.type("html").send(ageView(room));

  const files = await listFiles(room);
  res.type("html").send(roomView(room, files, isAdminReq(req)));
});

// Confirm 18+
app.post("/age-ok/:room", (req,res)=>{
  const room = sanitizeRoom(req.params.room);
  if(!room) return res.status(400).send("bad room");
  res.cookie(ageCookie(room), "1", { httpOnly:false, sameSite:"Lax", maxAge:365*24*3600e3 });
  res.redirect(`/r/${encodeURIComponent(room)}`);
});

// Upload (everyone)
const storageMw = upload.single("file");
app.post("/upload/:room", (req,res,next)=>{
  // If age not confirmed yet, block upload until they pass the gate
  const room = sanitizeRoom(req.params.room);
  if(!room) return res.status(400).send("bad room");
  const ok = req.cookies[ageCookie(room)] === "1";
  if(!ok) return res.status(403).send("age check required");
  next();
}, storageMw, (req,res)=>{
  const room = sanitizeRoom(req.params.room);
  if(!req.file) return res.status(400).send("no file");
  res.redirect(`/r/${encodeURIComponent(room)}`);
});

// Serve & download
app.get("/file/:room/:name",(req,res)=>{
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name||"");
  if(!room||!name) return res.status(400).send("bad request");
  const full = path.join(roomDir(room), name);
  if(!fs.existsSync(full)) return res.status(404).send("not found");
  res.type(mime.lookup(full) || "application/octet-stream");
  fs.createReadStream(full).pipe(res);
});
app.get("/download/:room/:name",(req,res)=>{
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name||"");
  if(!room||!name) return res.status(400).send("bad request");
  const full = path.join(roomDir(room), name);
  if(!fs.existsSync(full)) return res.status(404).send("not found");
  res.download(full, name);
});

// Delete file/room (admin)
app.post("/delete/:room/:name", async (req,res)=>{
  if(!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const name = path.basename(req.params.name||"");
  try{ await fsp.unlink(path.join(roomDir(room), name)); }catch{}
  res.redirect(`/r/${encodeURIComponent(room)}`);
});
app.post("/delete-room/:room", async (req,res)=>{
  if(!isAdminReq(req)) return res.status(403).send("admin only");
  const room = sanitizeRoom(req.params.room);
  const typed = (req.body?.confirm || "").trim();
  if(typed !== room) return res.status(400).send("confirmation mismatch");
  await fsp.rm(roomDir(room), { recursive:true, force:true });
  res.redirect("/manage");
});

// --- start ---
await ensureBase();
app.listen(PORT, ()=>console.log("Rooms server on :"+PORT));
