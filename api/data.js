import fs from "fs";
import path from "path";
function loadData(){
  const p=path.join(process.cwd(),"index.html");
  if(!fs.existsSync(p)) return null;
  const h=fs.readFileSync(p,"utf8");
  const m=h.match(/(?:const|let) DATA = (\{[\s\S]*?\});\s*\n?\s*(?:const |let |function |document\.)/);
  if(!m) return null;
  try{ return JSON.parse(m[1]); }catch{ return null; }
}
export default function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS"){res.status(200).end(); return;}
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const DATA=loadData();
  if(!DATA) return res.status(500).json({error:"Dashboard data not available"});
  // Support ?plant=accl for single plant live fetch
  const plantId=req.query.plant;
  if(plantId){
    const plant=DATA.plants?.[plantId];
    if(!plant) return res.status(404).json({error:`Plant ${plantId} not found`, available: DATA.order});
    return res.status(200).json({plant, meta: plant.meta, generated: DATA.generated});
  }
  return res.status(200).json(DATA);
}
