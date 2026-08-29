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
  if(req.method==="OPTIONS"){res.status(200).end(); return;}
  const bu=parseInt(req.query.bu||"0",10);
  const month=req.query.month || new Date().toISOString().slice(0,7);
  if(!bu) return res.status(400).json({error:"bu required"});
  const DATA=loadData();
  if(!DATA) return res.status(500).json({error:"Dashboard data not available"});
  // find plant(s) with this BU
  const plantsWithBu=Object.entries(DATA.plants).filter(([k,p])=>p.meta&&p.meta.bu===bu);
  if(!plantsWithBu.length) return res.status(404).json({error:`BU ${bu} not found`, bu, month});
  const plant=plantsWithBu[0][1];
  const budgetRow=(plant.mohBudget||[]).find(x=>x.k===month);
  if(budgetRow) return res.status(200).json({bu, month, budget: budgetRow.b, source:"embedded_mohBudget", plant: plant.meta.name});
  // fallback: try to compute from moh avg if available
  const moh=plant.moh||[];
  if(moh.length){
    const avg=moh.slice(-6).reduce((s,x)=>s+x.c,0)/Math.min(6,moh.length);
    return res.status(200).json({bu, month, budget: Math.round(avg*1.08), source:"fallback_108pct_6M_avg_computed", plant: plant.meta.name});
  }
  return res.status(200).json({bu, month, budget: null, source:"none"});
}
