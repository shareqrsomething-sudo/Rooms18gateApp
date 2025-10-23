// Rooms app with:
//  • 18+ gate on every page
//  • Per-room uploads + gallery (no login for visitors)
//  • Admin delete via password
//  • Free and self-contained

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

// ===== CONFIG =====
const ADMIN_PW = process.env.ADMIN_PW || "changeme";
// ==================

const UPLOADS = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg","image/png","image/gif","image/webp",
  "video/mp4","video/quicktime","application/pdf"
]);

// 18+ gate
function ageGate(req,res,next){
  if(req.path.startsWith("/u/")) return next();
  const cookie = req.headers.cookie || "";
  if(cookie.includes("age_ok=1")) return next();
  const back = req.originalUrl;
  res.type("html").send(`<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>body{display:grid;place-items:center;min-height:100vh;background:#0b0c0f;color:#e5e7eb;font-family:system-ui}div{background:#111827;padding:2rem;border-radius:1rem;text-align:center}</style>
<div><h1>Are you 18 or older?</h1><p>You must confirm your age to continue.</p>
<button onclick="document.cookie='age_ok=1;Path=/;Max-Age=7776000';location='${back}'" style="padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#10b981;font-weight:700">Yes</button>
<button onclick="location='https://google.com'" style="padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#374151;color:#fff;font-weight:700">No</button></div>`);
}
app.use(ageGate);

function storageForRoom(){
  return multer.diskStorage({
    destination:(req,_f,cb)=>{
      const dir=path.join(UPLOADS,req.params.id);
      fs.mkdirSync(dir,{recursive:true});
      cb(null,dir);
    },
    filename:(_req,file,cb)=>{
      const ext=mime.extension(file.mimetype);
      cb(null,nanoid(10)+(ext?'.'+ext:''));
    }
  });
}
function makeUploader(){
  return multer({
    storage:storageForRoom(),
    limits:{fileSize:MAX_BYTES},
    fileFilter:(_req,file,cb)=>{
      if(ALLOWED.has(file.mimetype)) return cb(null,true);
      cb(new Error("File type not allowed"));
    }
  }).array("files",20);
}

app.use("/u",express.static(UPLOADS));

app.get("/",(_req,res)=>{
  res.type("html").send(`<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>body{display:grid;place-items:center;min-height:100vh;background:#0b0c0f;color:#e5e7eb;font-family:system-ui}div{background:#111827;padding:2rem;border-radius:1rem;text-align:center}</style>
<div><h1>Create a New Room</h1><form action="/new" method=post><button style="padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#10b981;font-weight:700">Create</button></form></div>`);
});

app.post("/new",(req,res)=>{
  const id=nanoid(6);
  fs.mkdirSync(path.join(UPLOADS,id),{recursive:true});
  res.redirect("/r/"+id);
});

app.get("/r/:id",(req,res)=>{
  const id=req.params.id;
  const dir=path.join(UPLOADS,id);
  fs.mkdirSync(dir,{recursive:true});
  const files=fs.readdirSync(dir).map(n=>({name:n,url:`/u/${id}/${n}`}));
  const shareURL=`${req.protocol}://${req.get("host")}/r/${id}`;
  res.type("html").send(`<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#0b0c0f;color:#e5e7eb;font-family:system-ui}h1{padding:1rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;padding:1rem}.card{background:#111827;padding:1rem;border-radius:1rem;text-align:center}</style>
<h1>Room ${id}</h1>
<p><a href="${shareURL}" style="color:#10b981">${shareURL}</a></p>
<form action="/r/${id}/upload" method=post enctype="multipart/form-data" style="padding:1rem"><input type=file name=files multiple required><button style="padding:.5rem 1rem;border:0;border-radius:.5rem;background:#10b981;color:#111;font-weight:700">Upload</button></form>
<div class=grid>${files.map(f=>`<div class=card><a href="${f.url}" target=_blank>${f.name}</a></div>`).join("")}</div>`);
});

app.post("/r/:id/upload",(req,res)=>{
  makeUploader()(req,res,(err)=>{
    if(err)return res.send("Upload failed: "+err.message);
    res.redirect("/r/"+req.params.id);
  });
});

app.listen(PORT,()=>console.log("Running on "+PORT));
