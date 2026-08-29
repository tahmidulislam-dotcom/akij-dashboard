import fs from "fs";
import sql from "mssql";
const PLANTS=[
  {key:'accl', bu:4, plants:['ACCL Narayanganj']},
  {key:'apfil', bu:8, plants:['Narayangonj Plant']},
  {key:'aafl', bu:232, plants:['AAFML Narayangonj Factory']},
  {key:'aelflour', bu:144, plants:['AEL Flour Narayanganj','AEL Mohadevpur']},
  {key:'aeldal', bu:144, plants:['AEL Dal Narayanganj']},
  {key:'ail', bu:224, plants:['Akij Ispat Munshiganj']},
  {key:'absl', bu:220, plants:['ABSL Ashuliya']},
  {key:'armcl-ngnj', bu:175, plants:['ARMCL Narayanganj Plant']},
  {key:'armcl-dhour', bu:175, plants:['ARMCL Dhour Plant']},
  {key:'armcl-rup', bu:175, plants:['ARMCL Rupganj Plant']},
  {key:'armcl-ctg', bu:175, plants:['ARMCL Chittagong Plant']},
  {key:'armcl-gaz', bu:175, plants:['ARMCL Gazipur Plant']},
  {key:'hrml', bu:188, plants:['Hashem Rice Mills']},
  {key:'fal', bu:189, plants:['Fariq Agro Ltd.']},
  {key:'alel', bu:237, plants:[]},
];
const esc=s=>s.replace(/'/g,"''");
const norm=alias=>`LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(${alias}, CHAR(9), ''), CHAR(10), ''), CHAR(13), '')))`;
const plantIn=(p,alias)=> p.plants.length ? `${norm(alias||'strPlantName')} IN (${p.plants.map(x=>`'${esc(x)}'`).join(',')})` : '1=0';
let pool=null;
let cache=null;
let cacheAt=0;
const CACHE_MS=2*60*1000;
async function getPool(){
  if(pool && pool.connected) return pool;
  const cfg={
    server: process.env.MSSQL_SERVER||'203.202.241.211',
    port: parseInt(process.env.MSSQL_PORT||'1433'),
    user: process.env.MSSQL_USER||'mcp_user',
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE||'DWH',
    options:{encrypt:false, trustServerCertificate:true},
    pool:{max:3, min:0, idleTimeoutMillis:10000},
    connectionTimeout:15000,
    requestTimeout:15000,
  };
  if(!cfg.password) throw new Error('MSSQL_PASSWORD not set');
  pool=await new sql.ConnectionPool(cfg).connect();
  return pool;
}

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS"){res.status(200).end(); return;}
  const todayParam=req.query.date;
  // Dhaka today
  const dhakaToday = todayParam || new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'});
  if(Date.now()-cacheAt < CACHE_MS && cache && cache.date===dhakaToday && !req.query.nocache){
    return res.status(200).json(cache);
  }
  // Check pushed live cache first (from local office via /api/push-live -> Gist)
  try{
    if(global.__liveCache && global.__liveCache.date===dhakaToday){
      const age=Date.now()-new Date(global.__liveCache._pushedAt||0).getTime();
      if(age < 30*60*1000) return res.status(200).json({...global.__liveCache, source:"pushed-live-memory"});
    }
    const p="/tmp/live-cache.json";
    if(fs.existsSync(p)){
      const j=JSON.parse(fs.readFileSync(p,"utf8"));
      if(j.date===dhakaToday){
        const age=Date.now()-new Date(j._pushedAt||0).getTime();
        if(age < 30*60*1000) return res.status(200).json({...j, source:"pushed-live-file"});
      }
    }
    // Try GitHub Gist (cross-instance, survives cold starts)
    const gistUrl=process.env.GIST_RAW_URL || (process.env.GIST_ID ? `https://gist.githubusercontent.com/tahmidulislam-dotcom/${process.env.GIST_ID}/raw/akij-live.json` : null);
    if(gistUrl){
      try{
        const gr=await fetch(gistUrl,{cache:'no-store'});
        if(gr.ok){
          const gj=await gr.json();
          if(gj.date===dhakaToday && gj.plants && Object.keys(gj.plants).length){
            const age=Date.now()-new Date(gj._pushedAt||0).getTime();
            if(age < 30*60*1000) return res.status(200).json({...gj, source:"gist-live"});
          }
        }
      }catch{}
    }
  }catch{}
  try{
    const p=await getPool();
    const Q=async q=> (await p.request().query(q)).recordset;
    const out={date: dhakaToday, generated: new Date().toISOString(), plants:{}};
    // For each plant, fetch today's OEE, MOH, NPT in parallel batches
    await Promise.all(PLANTS.map(async P=>{
      const pin=plantIn(P);
      const bu=P.bu;
      // OEE today
      const daily = P.plants.length ? await Q(`
        SELECT CONVERT(varchar(10), dteProductionDate, 23) d, LTRIM(RTRIM(strUOMName)) u,
               SUM(ISNULL(numLoadingMinute,0)) l, SUM(ISNULL(NumMachineRuntime,0)) r,
               SUM(ISNULL(numActualOutputQuantity,0)) a, SUM(ISNULL(numGoodOutputQuantity,0)) g,
               SUM(ISNULL(numCapacityPerHr,0) * ISNULL(NumMachineRuntime,0) / 60.0) cr,
               SUM(ISNULL(numCapacityPerHr,0) * ISNULL(numShiftDurationMinute,0) / 60.0) cs
        FROM mes.tblOeeProdWasteHeaderArc
        WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1 AND ${pin}
          AND CONVERT(varchar(10), dteProductionDate, 23)='${dhakaToday}'
        GROUP BY CONVERT(varchar(10), dteProductionDate, 23), LTRIM(RTRIM(strUOMName))`) : [];
      // MOH today (actual overhead cost for today)
      let mohToday=0;
      try{
        const r=await Q(`SELECT SUM(ISNULL(pr.numOverheadCost,0)) as c FROM mes.tblProductionRowArc pr JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId=pr.intProductionOrderId WHERE po.intBusinessUnitId=${bu} AND pr.isActive=1 AND CONVERT(varchar(10), po.dteStartDate, 23)='${dhakaToday}'`);
        mohToday=Number(r[0]?.c||0);
      }catch{}
      // NPT today total
      let nptToday=0;
      try{
        if(P.plants.length){
          const r=await Q(`SELECT SUM(ISNULL(r.intLossTimeInMinutes,0)) as m FROM mes.tblNPTRowArc r JOIN mes.tblNPTHeaderArc h ON h.intNPTId=r.intNPTId WHERE h.intBusinessUnitId=${bu} AND r.isActive=1 AND ${plantIn(P,'h.strPlantName')} AND CONVERT(varchar(10), h.dteLossTimeDate,23)='${dhakaToday}'`);
          nptToday=Number(r[0]?.m||0);
        }
      }catch{}
      out.plants[P.key]={bu, today: dhakaToday, daily: daily.map(x=>({d:x.d,u:(x.u||'Unit').replace(/\s+/g,''),l:Math.round(x.l),r:Math.round(x.r),a:Math.round(x.a*100)/100,g:Math.round(x.g*100)/100,cr:Math.round(x.cr*100)/100,cs:Math.round(x.cs*100)/100})), mohToday: Math.round(mohToday*100)/100, nptMinToday: nptToday };
    }));
    cache=out; cacheAt=Date.now();
    return res.status(200).json(out);
  }catch(e){
    // fallback to embedded static if DWH unreachable
    console.error('live DWH failed', e.message);
    return res.status(200).json({date: dhakaToday, generated: new Date().toISOString(), error: e.message, fallback: true, plants:{}});
  }
}
