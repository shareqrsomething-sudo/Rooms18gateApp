// app.js — Rooms with hard 18+ gate (no nested template literals)

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

// ---------- config ----------
const DATA = path.join(__dirname, "data");
const ADMIN_PASS = process.env.ADMIN_PASS || "letmein";        // set in Render
const COOKIE_SECRET = process.env.COOKIE_SECRET || "change-me"; // set in Render
const AGE_COOKIE = "age_ok";
const MAX_UPLOAD_MB = 50;

// ensure data dir
fs.mkdirSync(DATA, { recursive: true });

// uploads per room -> ./data/<room>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const room = req.params.room;
    const dir = path.join(DATA, room);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-100);
    cb(null, ts + "-" + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

// ---------- middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use("/static", express.static(path.join(__dirname, "static")));

// 18+ gate middleware
const ageGate = (req, res, next) => {
  const open = ["/gate", "/gate/ok", "/gate/reset", "/healthz"];
  if (open.includes(req.path) || req.path.startsWith("/static/")) return next();
  if (req.signedCookies[AGE_COOKIE] === "1") return next();
  res.redirect("/gate?next=" + encodeURIComponent(req.originalUrl));
};
app.use(ageGate);

// ---------- gate ----------
app.get("/gate", (req, res) => {
  const next = req.query.next || "/";
  res.send(
    "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>18+</title>" +
    "<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0}" +
    ".card{background:#111827;border:1px solid #232936;border-radius:14px;padding:28px;max-width:560px;width:92%}" +
    "h1{margin:0 0 14px;font-size:28px} p{opacity:.85;margin:0 0 18px}" +
    ".row{display:flex;gap:10px;flex-wrap:wrap}" +
    "button,a.btn{flex:1 1 180px;padding:12px;border:0;border-radius:10px;font-weight:700;font-size:16px;cursor:pointer;text-align:center}" +
    ".yes{background:#22c55e;color:#062}.no{background:#374151;color:#cbd5e1}</style>" +
    "<div class='card'><h1>Are you 18 or older?</h1><p>You must confirm your age to continue.</p>" +
    "<div class='row'>" +
    "<form method='post' action='/gate/ok'>" +
    "<input type='hidden' name='next' value='" + next.replace(/'/g, "&#39;") + "'>" +
    "<button class='yes' type='submit'>Yes</button></form>" +
    "<a class='btn no' href='https://www.google.com'>No</a>" +
    "</div></div>"
  );
});

app.post("/gate/ok", (req, res) => {
  const next = req.body.next || "/";
  res.cookie(AGE_COOKIE, "1", {
    signed: true, httpOnly: true, sameSite: "lax", maxAge: 7*24*60*60*1000
  });
  res.redirect(next);
});

app.get("/gate/reset", (_req, res) => {
  res.clearCookie(AGE_COOKIE);
  res.redirect("/gate");
});

// ---------- helpers ----------
const listRooms = () =>
  fs.readdirSync(DATA, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

const isValidRoom = name => /^[a-z0-9-]{1,40}$/.test(name);

// ---------- landing (no create unless admin) ----------
app.get("/", (req, res) => {
  const rooms = listRooms();
  const isAdmin = req.query.admin === ADMIN_PASS;

  let listHtml = rooms.length
    ? "<ul>" + rooms.map(r =>
        "<li class='room'><a class='btn' href='/r/" + encodeURIComponent(r) +
        "'>Enter: " + r + "</a></li>"
      ).join("") + "</ul>"
    : "<p>No rooms yet.</p>";

  const adminBtn = isAdmin
    ? "<a class='btn' href='/'>Exit admin</a>"
    : "<a class='btn' href='/?admin=" + encodeURIComponent(ADMIN_PASS) + "'>Admin</a>";

  const createUI = isAdmin ? (
    "<h2>Create room</h2>" +
    "<form method='post' action='/rooms" + (isAdmin ? "?admin=" + encodeURIComponent(ADMIN_PASS) : "") + "'>" +
    "<input name='name' placeholder='room-name (letters/numbers/dashes)' required pattern='[a-z0-9-]{1,40}'>" +
    "<button type='submit'>Create</button></form>"
  ) : "";

  res.send(
    "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Rooms</title>" +
    "<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}" +
    ".card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:760px;margin:0 auto}" +
    "h1{margin:0 0 12px} h2{margin:18px 0 10px}" +
    "a.btn,button{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;border:0;font-weight:700}" +
    "ul{list-style:none;padding:0;margin:10px 0 0} li{margin:6px 0}" +
    ".room{background:#0f172a;border-radius:8px;padding:10px 12px;border:1px solid #23303f}" +
    "input{background:#0f172a;border:1px solid #23303f;color:#eaeef5;border-radius:8px;padding:10px;width:100%;max-width:360px;margin-right:8px}" +
    "</style>" +
    "<div class='card'>" +
    "<div style='display:flex;justify-content:space-between;align-items:center'><h1>Rooms</h1>" +
    adminBtn + "</div>" +
    "<h2>Existing rooms</h2>" + listHtml + createUI +
    "</div>"
  );
});

// create room (admin)
app.post("/rooms", (req, res) => {
  if (req.query.admin !== ADMIN_PASS) return res.status(403).send("Admin only");
  const name = (req.body.name || "").trim();
  if (!isValidRoom(name)) return res.status(400).send("Invalid room name");
  fs.mkdirSync(path.join(DATA, name), { recursive: true });
  res.redirect("/?admin=" + encodeURIComponent(ADMIN_PASS));
});

// delete room (admin + confirm)
app.post("/r/:room/delete", (req, res) => {
  if (req.query.admin !== ADMIN_PASS) return res.status(403).send("Admin only");
  const room = req.params.room;
  const confirm = req.body.confirm || "";
  if (confirm !== room) return res.status(400).send("Type the room name to confirm deletion.");
  const dir = path.join(DATA, room);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.redirect("/?admin=" + encodeURIComponent(ADMIN_PASS));
});

// room page
app.get("/r/:room", (req, res) => {
  const room = req.params.room;
  if (!isValidRoom(room)) return res.status(404).send("Room not found");
  const dir = path.join(DATA, room);
  fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir).map(name => {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    return { name, bytes: stat.size, type: mime.lookup(name) || "application/octet-stream" };
  });

  const admin = req.query.admin === ADMIN_PASS;

  // build items without nested backticks
  const items = files.map(f => {
    const enc = encodeURIComponent(f.name);
    const href = "/file/" + encodeURIComponent(room) + "/" + enc;
    const del = admin
      ? "<form method='post' action='/delete/" + encodeURIComponent(room) + "/" + enc +
        "?admin=" + encodeURIComponent(ADMIN_PASS) +
        "' onsubmit='return confirm(\"Delete " + (f.name.replace(/"/g, "&quot;")) + "?\")'>" +
        "<button class='del'>Delete</button></form>"
      : "";
    return "<div class='item'><div style='margin:6px 0 8px;word-break:break-word'>" +
           f.name + "</div><a class='btn' href='" + href + "' download>Download</a> " + del + "</div>";
  }).join("");

  const adminToggle = admin
    ? "<a class='btn' href='/r/" + encodeURIComponent(room) + "'>Exit admin</a>"
    : "<a class='btn' href='/r/" + encodeURIComponent(room) + "?admin=" + encodeURIComponent(ADMIN_PASS) + "'>Admin</a>";

  res.send(
    "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Room: " + room + "</title>" +
    "<style>body{background:#0b0c0f;color:#eaeef5;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:26px}" +
    ".card{background:#111827;border:1px solid #232936;border-radius:14px;padding:22px;max-width:900px;margin:0 auto}" +
    ".grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}" +
    ".item{background:#0f172a;border:1px solid #23303f;border-radius:10px;padding:10px}" +
    "a.btn,button{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;border:0;font-weight:700}" +
    ".del{background:#dc2626}" +
    "input{background:#0f172a;border:1px solid #23303f;color:#eaeef5;border-radius:8px;padding:10px}" +
    "</style>" +
    "<div class='card'>" +
    "<div style='display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap'>" +
    "<h1>Room: " + room + "</h1><div><a class='btn' href='/'>Rooms</a> " + adminToggle + "</div></div>" +
    "<form method='post' action='/upload/" + encodeURIComponent(room) + "' enctype='multipart/form-data' " +
    "style='margin:10px 0 18px;display:flex;gap:10px;flex-wrap:wrap'>" +
    "<input type='file' name='file' required><button type='submit'>Upload</button></form>" +
    (admin
      ? "<form method='post' action='/r/" + encodeURIComponent(room) + "/delete?admin=" + encodeURIComponent(ADMIN_PASS) +
        "' onsubmit='return confirm(\"Type the room name to confirm deletion\")' style='margin:4px 0 16px'>" +
        "<input name='confirm' placeholder=\"type '" + room + "' to delete room\" required pattern='" + room + "'>" +
        "<button class='del' type='submit'>Delete Room</button></form>"
      : "") +
    "<div class='grid'>" + items + "</div></div>"
  );
});

// upload one file
app.post("/upload/:room", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file");
  res.redirect("/r/" + encodeURIComponent(req.params.room));
});

// serve / download a file
app.get("/file/:room/:name", (req, res) => {
  const p = path.join(DATA, req.params.room, req.params.name);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.download(p, req.params.name);
});

// delete a file (admin)
app.post("/delete/:room/:name", (req, res) => {
  if (req.query.admin !== ADMIN_PASS) return res.status(403).send("Admin only");
  const p = path.join(DATA, req.params.room, req.params.name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.redirect("/r/" + encodeURIComponent(req.params.room) + "?admin=" + encodeURIComponent(ADMIN_PASS));
});

// health
app.get("/healthz", (_req, res) => res.send("ok"));

app.listen(PORT, () => console.log("listening on", PORT));
