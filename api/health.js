import fs from "fs";
import path from "path";
export default function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method==="OPTIONS"){ res.status(200).end(); return; }
  const hasEnv = !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_REFRESH_TOKEN;
  const hasTokenFile = fs.existsSync(path.join(process.env.USERPROFILE||"",".google_workspace_mcp","credentials","tahmidulislam@akijresource.com.json"));
  res.status(200).json({
    ok:true,
    vercel:true,
    dashboard: fs.existsSync(path.join(process.cwd(),"index.html")),
    env: hasEnv ? "vercel-env" : "missing",
    tokenFile: hasTokenFile,
    hint: hasEnv ? "Gmail env vars set" : "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in Vercel env",
    time: new Date().toISOString()
  });
}
