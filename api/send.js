import fs from "fs";
import path from "path";
const CFG_PATH="/tmp/dashboard-config.json";
const validEmail=e=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
function loadCfg(){ try{ if(fs.existsSync(CFG_PATH)) return JSON.parse(fs.readFileSync(CFG_PATH,"utf8")); }catch{} return {emails:[]}; }
const sanitize=h=>String(h).replace(/<script[\s\S]*?<\/script>/gi,"").replace(/ on\w+="[^"]*"/gi,"").replace(/javascript:/gi,"");

let accessToken=null, tokenExp=0;
async function getAccessToken(){
  if(accessToken && Date.now() < tokenExp - 60000) return accessToken;
  // Try env vars first (Vercel), fallback to local file
  const envClientId=process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const envRefresh=process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const envToken=process.env.GOOGLE_ACCESS_TOKEN;
  const envExpiry=process.env.GOOGLE_TOKEN_EXPIRY;
  if(envClientId && envRefresh){
    // if we have a cached env token that's still valid
    if(envToken && envExpiry && Number(envExpiry) > Date.now()+60000){
      accessToken=envToken; tokenExp=Number(envExpiry); return accessToken;
    }
    // refresh via Google
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({client_id:envClientId, client_secret:envSecret, refresh_token:envRefresh, grant_type:"refresh_token"})});
    const d=await r.json();
    if(!d.access_token) throw new Error("Gmail token refresh failed (env): "+(d.error_description||d.error||"unknown")+" — check Vercel env GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN");
    accessToken=d.access_token; tokenExp=Date.now()+(d.expires_in-60)*1000; return accessToken;
  }
  // Fallback: local token file (when running locally via vercel dev)
  const TOKEN_FILE=path.join(process.env.USERPROFILE||"",".google_workspace_mcp","credentials",(process.env.GOOGLE_EMAIL||"tahmidulislam@akijresource.com")+".json");
  if(!fs.existsSync(TOKEN_FILE)) throw new Error("Gmail credentials not configured — set Vercel env GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (from "+TOKEN_FILE+") or deploy with token file");
  const tok=JSON.parse(fs.readFileSync(TOKEN_FILE,"utf8"));
  const client_id=tok.client_id||envClientId;
  const client_secret=tok.client_secret||envSecret;
  const tokenVal=tok.token||tok.access_token;
  const expiryVal=tok.expiry_date||tok.expiry||tok.expiresAt;
  let expiryMs=null;
  if(expiryVal!=null){
    expiryMs=Number(expiryVal)>1e12?Number(expiryVal):Number(expiryVal)*1000;
    if(Number(expiryVal)<1e12 && Number(expiryVal)>1e9 && String(expiryVal).length<=10) expiryMs=Number(expiryVal)*1000;
    if(!isNaN(expiryMs) && tokenVal && expiryMs>Date.now()+60000){ accessToken=tokenVal; tokenExp=expiryMs; return accessToken; }
  }
  if(!tok.refresh_token && !envRefresh) throw new Error("No refresh_token in credentials");
  const refresh=tok.refresh_token||envRefresh;
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({client_id, client_secret, refresh_token:refresh, grant_type:"refresh_token"})});
  const d=await r.json();
  if(!d.access_token) throw new Error("Gmail token refresh failed: "+(d.error_description||d.error||"unknown"));
  accessToken=d.access_token; tokenExp=Date.now()+(d.expires_in-60)*1000; return accessToken;
}
async function gmailSend(to, subject, html){
  const at=await getAccessToken();
  const mime=["To: "+to.join(","), 'Content-Type: text/html; charset="UTF-8"',"MIME-Version: 1.0","Subject: =?UTF-8?B?"+Buffer.from(subject).toString("base64")+"?=","",html].join("\r\n");
  const raw=Buffer.from(mime).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST", headers:{Authorization:"Bearer "+at,"Content-Type":"application/json"}, body:JSON.stringify({raw})});
  const d=await r.json();
  if(r.status===401){ accessToken=null; return gmailSend(to, subject, html); }
  if(!r.ok) throw new Error("Gmail API "+r.status+": "+(d.error&&d.error.message||"send failed"));
  return d.id;
}

export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method==="OPTIONS"){ res.status(200).end(); return; }
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  let body=req.body;
  if(!body || typeof body==="string"){ try{ body=JSON.parse(body||"{}"); }catch{ body={}; } }
  const cfg=loadCfg();
  const toList=(body.to && body.to.length ? body.to : cfg.emails||[]).map(e=>String(e).trim().toLowerCase()).filter(validEmail);
  if(toList.length===0) return res.status(400).json({error:"No valid recipients — add at least one email and click Save Addresses (or send 'to' array)"});
  if(toList.length>5) return res.status(400).json({error:"Maximum 5 recipients allowed"});
  if(!body.subject || !body.html) return res.status(400).json({error:"subject and html required"});
  try{
    const id=await gmailSend(toList, body.subject, sanitize(body.html));
    return res.status(200).json({ok:true, message_id:id, sent_to:toList});
  }catch(e){
    return res.status(500).json({error:e.message});
  }
}
