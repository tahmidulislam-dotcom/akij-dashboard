import fs from "fs";
const CACHE_PATH="/tmp/live-cache.json";
const SECRET=process.env.PUSH_SECRET || process.env.LIVE_PUSH_SECRET;
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, x-push-secret");
  if(req.method==="OPTIONS"){res.status(200).end(); return;}
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const provided=req.headers["x-push-secret"] || req.query.secret || (req.body&&req.body._secret);
  if(SECRET && provided!==SECRET) return res.status(401).json({error:"Invalid push secret"});
  let body=req.body;
  if(!body || typeof body==="string"){ try{ body=JSON.parse(body||"{}"); }catch{ body={}; } }
  // remove _secret from stored payload
  if(body._secret) delete body._secret;
  if(!body.date || !body.plants) return res.status(400).json({error:"date and plants required"});
  try{
    const payload={...body, _pushedAt: new Date().toISOString()};
    try{ fs.writeFileSync(CACHE_PATH, JSON.stringify(payload)); }catch{}
    global.__liveCache=payload;
    // also update GitHub Gist for cross-instance persistence
    const gistId=process.env.GIST_ID;
    const ghToken=process.env.GITHUB_TOKEN;
    if(gistId && ghToken){
      try{
        await fetch(`https://api.github.com/gists/${gistId}`,{
          method:"PATCH",
          headers:{Authorization:`Bearer ${ghToken}`, "Content-Type":"application/json"},
          body: JSON.stringify({files:{"akij-live.json":{content: JSON.stringify(payload, null, 2)}}})
        });
      }catch{}
    }
    return res.status(200).json({ok:true, date: body.date, plants: Object.keys(body.plants).length, gist: !!gistId});
  }catch(e){ return res.status(500).json({error:e.message}); }
}
