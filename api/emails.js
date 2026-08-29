import fs from "fs";
import path from "path";
const CFG_PATH = "/tmp/dashboard-config.json";
const DASH_PATH = path.join(process.cwd(), "index.html");

function loadCfg(){
  try{
    if(fs.existsSync(CFG_PATH)) return JSON.parse(fs.readFileSync(CFG_PATH,"utf8"));
  }catch{}
  // fallback: try read from index.html embedded default? just empty
  return { emails: [] };
}
function saveCfg(cfg){
  try{ fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2)); }catch{}
}
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export default function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method==="OPTIONS"){ res.status(200).end(); return; }
  if(req.method==="GET"){
    const cfg=loadCfg();
    // also allow query param check for Vercel env default
    return res.status(200).json({ emails: cfg.emails || [] });
  }
  if(req.method==="POST"){
    let body=req.body;
    if(!body || typeof body==="string"){ try{ body=JSON.parse(body||"{}"); }catch{ body={}; } }
    const list=(body.emails||[]).map(e=>String(e).trim().toLowerCase()).filter(validEmail);
    if(list.length===0) return res.status(400).json({ error:"No valid email addresses" });
    if(list.length>5) return res.status(400).json({ error:"Maximum 5 recipients allowed" });
    if(new Set(list).size!==list.length) return res.status(400).json({ error:"Duplicate addresses" });
    const cfg=loadCfg(); cfg.emails=list; saveCfg(cfg);
    return res.status(200).json({ ok:true, count:list.length, emails:list });
  }
  res.status(405).json({ error:"Method not allowed" });
}
