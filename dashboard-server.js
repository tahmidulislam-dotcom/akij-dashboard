/* Akij Cement Dashboard — LOCAL Duplicate with MOH Budget vs Today
   Serves local duplicate + AI analysis + email + MOH budget/today APIs.
   Run:  node dashboard-server-local.js   →  http://localhost:3212            */
const http = require('http');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const PORT = 3212;
const DIR = __dirname;
const DASH = path.join(DIR, 'akij-cement-dashboard-local.html');
const CFG = path.join(DIR, 'dashboard-config.json');
const TOKEN_FILE = path.join(process.env.USERPROFILE || '', '.google_workspace_mcp', 'credentials', (process.env.GOOGLE_EMAIL || 'tahmidulislam@akijresource.com') + '.json');

/* ---------- helpers ---------- */
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, err) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { err(e); } }); req.on('error', err); });
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return { emails: [] }; } };
const saveCfg = c => fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
const sanitize = h => String(h).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* ---------- MSSQL for MOH budget/today live fetch ---------- */
const mssqlConfig = {
  server: process.env.MSSQL_SERVER || '203.202.241.211',
  port: parseInt(process.env.MSSQL_PORT || '1433'),
  user: process.env.MSSQL_USER || 'mcp_user',
  password: process.env.MSSQL_PASSWORD || 'iAOS@35o997',
  database: process.env.MSSQL_DATABASE || 'DWH',
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 30000,
};
let mssqlPool = null;
async function getMssqlPool(){
  if(mssqlPool && mssqlPool.connected) return mssqlPool;
  mssqlPool = await new sql.ConnectionPool(mssqlConfig).connect();
  return mssqlPool;
}

/* ---------- Gmail OAuth (stored workspace-mcp token — handles both expiry formats) ---------- */
let accessToken = null, tokenExp = 0;
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExp - 60000) return accessToken;
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('Gmail token file not found: ' + TOKEN_FILE + ' — run workspace-mcp auth');
  const tok = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const client_id = tok.client_id || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const client_secret = tok.client_secret || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const tokenVal = tok.token || tok.access_token || tok.accessToken;
  const expiryVal = tok.expiry_date || tok.expiry || tok.expiresAt || tok.expires_at;
  // expiry may be seconds or ms; normalize to ms
  let expiryMs = null;
  if (expiryVal != null) {
    expiryMs = Number(expiryVal) > 1e12 ? Number(expiryVal) : Number(expiryVal) * 1000;
    // if value looks like seconds since epoch (< 1e12) but > 1e9, treat as seconds
    if (Number(expiryVal) < 1e12 && Number(expiryVal) > 1e9 && String(expiryVal).length <= 10) expiryMs = Number(expiryVal) * 1000;
    if (!isNaN(expiryMs) && tokenVal && expiryMs > Date.now() + 60000) { accessToken = tokenVal; tokenExp = expiryMs; return accessToken; }
  } else if (tokenVal && tok.refresh_token == null) {
    // token without expiry but no refresh — use it directly once
    accessToken = tokenVal; tokenExp = Date.now() + 3500*1000; return accessToken;
  }
  if (!tok.refresh_token) throw new Error('No refresh_token in stored Gmail credentials — re-auth with workspace-mcp');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Gmail token refresh failed: ' + (d.error_description || d.error || 'unknown'));
  accessToken = d.access_token; tokenExp = Date.now() + (d.expires_in - 60) * 1000;
  return accessToken;
}
async function gmailSend(to, subject, html) {
  const at = await getAccessToken();
  const mime = ['To: ' + to.join(','), 'Content-Type: text/html; charset="UTF-8"',
    'MIME-Version: 1.0', 'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=', '', html].join('\r\n');
  const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  const d = await r.json();
  if (r.status === 401) { accessToken = null; return gmailSend(to, subject, html); }
  if (!r.ok) throw new Error('Gmail API ' + r.status + ': ' + (d.error && d.error.message || 'send failed'));
  return d.id;
}

/* ---------- DeepSeek analysis ---------- */
const SYSTEM_PROMPT = `You are a senior manufacturing performance analyst for Akij Cement Company Ltd. (ACCL Narayanganj plant, Bangladesh — 2 VRM mills, 5 packers, 1 bulk loader).
You receive a JSON of computed KPIs for a date range plus the previous equal-length period and deltas.
Write a crisp, professional analysis report for plant management. Respond with a clean HTML fragment ONLY (no markdown fences, no <html>/<head>/<body>, no <script>).
Structure with <h3> headings and use a <table> for the key-metrics table (styled inline: border-collapse, 1px #ccc borders, th background #eef4f3, font-size 13px):
1. Executive Summary (3-5 bullet <li>)
2. Key Metrics vs Previous Period (table: Metric | Value | Change | Assessment)
3. OEE & Capacity Commentary (note: runtime capture started 2025-10-08; explain '—' values as data unavailability, never as bad performance)
4. Losses & Breakdown Analysis (top breakdowns with hrs/events, NPT categories, call out worst offenders)
5. Maintenance Effectiveness (MTBF, MTTR, MRO vs scheduled maintenance ratio, RCA status)
6. Planning & Output (plan achievement, bag/bulk output, SPC stability if given)
7. Recommendations (numbered, specific, actionable — reference the actual numbers)
Use ৳ for BDT amounts, thousands separators, % for percentages. Be honest about data gaps. Keep total under 900 words.`;

async function deepseekAnalyze(payload) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', timeout: 0,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.4, max_tokens: 3500,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: 'Analyze this ACCL dashboard data:\n' + JSON.stringify(payload) }]
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('DeepSeek ' + r.status + ': ' + (d.error && d.error.message || 'failed'));
  const html = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!html) throw new Error('Empty AI response');
  return sanitize(html);
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(DASH).pipe(res);
    }
    if (url.pathname === '/api/emails' && req.method === 'GET') return json(res, 200, { emails: loadCfg().emails || [] });
    if (url.pathname === '/api/emails' && req.method === 'POST') {
      const b = await readBody(req);
      const list = (b.emails || []).map(e => String(e).trim().toLowerCase()).filter(validEmail);
      if (list.length === 0) return json(res, 400, { error: 'No valid email addresses' });
      if (list.length > 5) return json(res, 400, { error: 'Maximum 5 recipients allowed' });
      if (new Set(list).size !== list.length) return json(res, 400, { error: 'Duplicate addresses' });
      const cfg = loadCfg(); cfg.emails = list; saveCfg(cfg);
      return json(res, 200, { ok: true, count: list.length, emails: list });
    }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.period || !b.period.from || !b.period.to) return json(res, 400, { error: 'period.from/to required' });
      if (!process.env.DEEPSEEK_API_KEY) return json(res, 200, { offline: true, reason: 'no API key configured — using built-in analyst engine' });
      try {
        const html = await deepseekAnalyze(b);
        return json(res, 200, { html });
      } catch (e) {
        if (/401|Authentication|invalid/i.test(e.message)) return json(res, 200, { offline: true, reason: 'API key invalid/expired — using built-in analyst engine' });
        return json(res, 200, { offline: true, reason: e.message + ' — using built-in analyst engine' });
      }
    }
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const b = await readBody(req);
      // allow client to omit 'to' if they have saved addresses
      const saved = loadCfg().emails || [];
      const to = (b.to && b.to.length ? b.to : saved).map(e => String(e).trim().toLowerCase()).filter(validEmail);
      if (to.length === 0) return json(res, 400, { error: 'No valid recipients — add at least one email and click Save Addresses' });
      if (to.length > 5) return json(res, 400, { error: 'Maximum 5 recipients allowed' });
      if (!b.subject || !b.html) return json(res, 400, { error: 'subject and html required' });
      const id = await gmailSend(to, b.subject, sanitize(b.html));
      return json(res, 200, { ok: true, message_id: id, sent_to: to });
    }
    if (url.pathname === '/api/moh-budget' && req.method === 'GET') {
      const bu = parseInt(url.searchParams.get('bu') || '0', 10);
      const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7);
      if(!bu) return json(res, 400, { error: 'bu required' });
      try{
        const pool = await getMssqlPool();
        // try budget tables first
        const candidates = [
          `SELECT SUM(ISNULL(numBudgetAmount,0)) as b FROM mes.tblMOHBudget WHERE intBusinessUnitId=${bu} AND CONVERT(varchar(7), dteBudgetMonth, 23)='${month}'`,
          `SELECT SUM(ISNULL(numOverheadBudget,0)) as b FROM mes.tblProductionBudget WHERE intBusinessUnitId=${bu} AND CONVERT(varchar(7), dteFromDate, 23)='${month}'`,
          `SELECT SUM(ISNULL(BudgetAmount,0)) as b FROM dbo.MOHBudget WHERE BusinessUnitId=${bu} AND CONVERT(varchar(7), BudgetMonth, 23)='${month}'`
        ];
        for(const q of candidates){
          try{ const r = await pool.request().query(q); const b = r.recordset[0]?.b; if(b && Number(b)>0) return json(res,200,{ bu, month, budget: Number(b), source:'budget_table' }); }catch(e){}
        }
        // fallback: 108% of 6M avg actual
        const r2 = await pool.request().query(`SELECT AVG(c) as avg6 FROM (SELECT TOP 6 SUM(ISNULL(pr.numOverheadCost,0)) as c FROM mes.tblProductionRowArc pr JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId=pr.intProductionOrderId WHERE po.intBusinessUnitId=${bu} AND pr.isActive=1 GROUP BY YEAR(po.dteStartDate), MONTH(po.dteStartDate) ORDER BY YEAR(po.dteStartDate) DESC, MONTH(po.dteStartDate) DESC) x`);
        const avg6 = r2.recordset[0]?.avg6;
        if(avg6) return json(res,200,{ bu, month, budget: Math.round(Number(avg6)*1.08), source:'fallback_108pct_6M_avg' });
        return json(res,200,{ bu, month, budget: null, source:'none' });
      }catch(e){ return json(res,200,{ bu, month, budget: null, source:'error', error: e.message }); }
    }
    if (url.pathname === '/api/moh-today' && req.method === 'GET') {
      const bu = parseInt(url.searchParams.get('bu') || '0', 10);
      const d = url.searchParams.get('d') || new Date().toISOString().slice(0,10);
      if(!bu) return json(res, 400, { error: 'bu required' });
      try{
        const pool = await getMssqlPool();
        const r = await pool.request().query(`SELECT SUM(ISNULL(pr.numOverheadCost,0)) as c FROM mes.tblProductionRowArc pr JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId=pr.intProductionOrderId WHERE po.intBusinessUnitId=${bu} AND pr.isActive=1 AND CONVERT(varchar(10), po.dteStartDate, 23)='${d}'`);
        return json(res,200,{ bu, d, actual: Number(r.recordset[0]?.c||0) });
      }catch(e){ return json(res,500,{ error: e.message }); }
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const cfg = loadCfg();
      const tokenExists = fs.existsSync(TOKEN_FILE);
      let tokenInfo = null;
      try{ const t=JSON.parse(fs.readFileSync(TOKEN_FILE,'utf8')); tokenInfo={ has_token: !!t.token, has_refresh: !!t.refresh_token, expiry: t.expiry || t.expiry_date || null }; }catch(e){}
      return json(res,200,{ ok:true, dashboard: fs.existsSync(DASH), emails: cfg.emails||[], tokenExists, tokenInfo, port:PORT });
    }
    if (url.pathname === '/api/data' && req.method === 'GET') {
      try{
        const html=fs.readFileSync(DASH,'utf8');
        const m=html.match(/(?:const|let) DATA = (\{[\s\S]*?\});\s*\n?\s*(?:const |let |function |document\.)/);
        if(!m) return json(res,500,{error:"DATA not found in dashboard"});
        const live=JSON.parse(m[1]);
        const plant=url.searchParams.get('plant');
        if(plant){
          const p=live.plants?.[plant];
          if(!p) return json(res,404,{error:`Plant ${plant} not found`, available: live.order});
          return json(res,200,{plant: p, meta: p.meta, generated: live.generated});
        }
        res.setHeader('Cache-Control','no-store');
        return json(res,200,live);
      }catch(e){ return json(res,500,{error:e.message}); }
    }
    if (url.pathname === '/api/live' && req.method === 'GET') {
      try{
        const dhakaToday=url.searchParams.get('date') || new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'});
        const pool=await getMssqlPool();
        const Q=async q=> (await pool.request().query(q)).recordset;
        const PLANTS_LIVE=[
          {key:'accl', bu:4, plants:['ACCL Narayanganj']},{key:'apfil', bu:8, plants:['Narayangonj Plant']},{key:'aafl', bu:232, plants:['AAFML Narayangonj Factory']},{key:'aelflour', bu:144, plants:['AEL Flour Narayanganj','AEL Mohadevpur']},{key:'aeldal', bu:144, plants:['AEL Dal Narayanganj']},{key:'ail', bu:224, plants:['Akij Ispat Munshiganj']},{key:'absl', bu:220, plants:['ABSL Ashuliya']},{key:'armcl-ngnj', bu:175, plants:['ARMCL Narayanganj Plant']},{key:'armcl-dhour', bu:175, plants:['ARMCL Dhour Plant']},{key:'armcl-rup', bu:175, plants:['ARMCL Rupganj Plant']},{key:'armcl-ctg', bu:175, plants:['ARMCL Chittagong Plant']},{key:'armcl-gaz', bu:175, plants:['ARMCL Gazipur Plant']},{key:'hrml', bu:188, plants:['Hashem Rice Mills']},{key:'fal', bu:189, plants:['Fariq Agro Ltd.']},{key:'alel', bu:237, plants:[]},
        ];
        const esc=s=>s.replace(/'/g,"''");
        const norm=alias=>`LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(${alias}, CHAR(9), ''), CHAR(10), ''), CHAR(13), '')))`;
        const plantIn=(p,alias)=> p.plants.length ? `${norm(alias||'strPlantName')} IN (${p.plants.map(x=>`'${esc(x)}'`).join(',')})` : '1=0';
        const out={date: dhakaToday, generated: new Date().toISOString(), plants:{}};
        for(const P of PLANTS_LIVE){
          const pin=plantIn(P);
          const daily = P.plants.length ? await Q(`SELECT CONVERT(varchar(10), dteProductionDate, 23) d, LTRIM(RTRIM(strUOMName)) u, SUM(ISNULL(numLoadingMinute,0)) l, SUM(ISNULL(NumMachineRuntime,0)) r, SUM(ISNULL(numActualOutputQuantity,0)) a, SUM(ISNULL(numGoodOutputQuantity,0)) g, SUM(ISNULL(numCapacityPerHr,0) * ISNULL(NumMachineRuntime,0) / 60.0) cr, SUM(ISNULL(numCapacityPerHr,0) * ISNULL(numShiftDurationMinute,0) / 60.0) cs FROM mes.tblOeeProdWasteHeaderArc WHERE intBusinessUnitId=${P.bu} AND ISNULL(isActive,1)=1 AND ${pin} AND CONVERT(varchar(10), dteProductionDate, 23)='${dhakaToday}' GROUP BY CONVERT(varchar(10), dteProductionDate, 23), LTRIM(RTRIM(strUOMName))`) : [];
          let mohToday=0; try{ const r=await Q(`SELECT SUM(ISNULL(pr.numOverheadCost,0)) as c FROM mes.tblProductionRowArc pr JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId=pr.intProductionOrderId WHERE po.intBusinessUnitId=${P.bu} AND pr.isActive=1 AND CONVERT(varchar(10), po.dteStartDate, 23)='${dhakaToday}'`); mohToday=Number(r[0]?.c||0);}catch{}
          out.plants[P.key]={bu:P.bu, daily: daily.map(x=>({d:x.d,u:(x.u||'Unit').replace(/\s+/g,''),l:Math.round(x.l),r:Math.round(x.r),a:Math.round(x.a*100)/100,g:Math.round(x.g*100)/100,cr:Math.round(x.cr*100)/100,cs:Math.round(x.cs*100)/100})), mohToday: Math.round(mohToday*100)/100 };
        }
        res.setHeader('Cache-Control','no-store');
        return json(res,200,out);
      }catch(e){ return json(res,200,{date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'}), generated: new Date().toISOString(), error: e.message, fallback:true, plants:{}}); }
    }
    if (url.pathname === '/api/proxy' && (req.method === 'GET' || req.method === 'POST')) {
      const MCP_URL = process.env.ARL_MCP_URL || "https://arl-mcp.ibos.io/mcp";
      const CONFIG = {
        finance:{key:"ibos_mcp_sec_fin_9c3d4e5f_6a7b_8c9d_0e1f_2a3b4c5d6e7f_F1n4",label:"Finance"},
        procurement:{key:"ibos_mcp_sec_pro_8b2c3d4e_5f6a_7b8c_9d0e_1f2a3b4c5d6e_Pr0c",label:"Procurement"},
        wms:{key:"ibos_mcp_sec_wms_1e5f6a7b_8c9d_0e1f_2a3b_4c5d6e7f8a9b_WmS9",label:"Warehouse (WMS)"},
        mes:{key:"ibos_mcp_sec_mes_5c9d0e1f_2a3b_4c5d_6e7f_8a9b0c1d2e3f_M3s8",label:"Manufacturing (MES)"},
        oms:{key:"ibos_mcp_sec_oms_6d0e1f2a_3b4c_5d6e_7f8a_9b0c1d2e3f4a_0mS7",label:"Order (OMS)"},
        import:{key:"ibos_mcp_sec_com_0d4e5f6a_7b8c_9d0e_1f2a_3b4c5d6e7f8a_1mp0",label:"Import/Commercial"},
        asset:{key:"ibos_mcp_sec_ast_7a1b2c3d_4e5f_6a7b_8c9d_0e1f2a3b4c5d_AsS3t",label:"Asset"},
        tms:{key:"ibos_mcp_sec_tms_7e1f2a3b_4c5d_6e7f_8a9b_0c1d2e3f4a5b_TmS6",label:"Transport (TMS)"},
        rtm:{key:"ibos_mcp_sec_rtm_2d6e7f8a_9b0c_1d2e_3f4a_5b6c7d8e9f0a_RtM2",label:"RTM"},
        cost:{key:"ibos_mcp_sec_cco_4b8c9d0e_1f2a_3b4c_5d6e_7f8a9b0c1d2e_C0st",label:"Costing"},
        partner:{key:"ibos_mcp_sec_prt_2f6a7b8c_9d0e_1f2a_3b4c_5d6e7f8a9b0c_P4rt",label:"Partners"},
        item:{key:"ibos_mcp_sec_itm_3a7b8c9d_0e1f_2a3b_4c5d_6e7f8a9b0c1d_1t3m",label:"Items"},
      };
      if(url.searchParams.get('list')==='1') return json(res,200,{ mcp_url:MCP_URL, domains:Object.entries(CONFIG).map(([d,c])=>({domain:d,label:c.label})) });
      let domain=url.searchParams.get('domain'), method=url.searchParams.get('method')||"tools/call", tool=url.searchParams.get('tool'), args=url.searchParams.get('args')||"{}";
      if(req.method==='POST' && req.body){ domain=req.body.domain||domain; method=req.body.method||method; tool=req.body.tool||tool; if(req.body.args && typeof req.body.args==='object') args=JSON.stringify(req.body.args); }
      if(typeof args==='string'){ try{ args=JSON.parse(args); }catch{ args={}; } }
      if(!domain) return json(res,400,{error:"domain required", domains:Object.keys(CONFIG)});
      const cfg=CONFIG[domain];
      if(!cfg) return json(res,400,{error:"unknown domain", domains:Object.keys(CONFIG)});
      let rpc;
      if(method==="initialize"){ rpc={jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"akij-dashboard",version:"3.0.0"}}}; }
      else if(method==="resources/list"){ rpc={jsonrpc:"2.0",id:1,method:"resources/list"}; }
      else if(method==="resources/read"){ rpc={jsonrpc:"2.0",id:1,method:"resources/read",params:{uri:url.searchParams.get('uri')||args.uri||""}}; }
      else if(method==="tools/list"){ rpc={jsonrpc:"2.0",id:1,method:"tools/list"}; }
      else { if(!tool) return json(res,400,{error:"tool required", domain}); rpc={jsonrpc:"2.0",id:1,method:"tools/call",params:{name:tool,arguments:args||{}}}; }
      try{
        const r=await fetch(MCP_URL,{method:"POST",headers:{"Content-Type":"application/json","X-API-Key":cfg.key},body:JSON.stringify(rpc)});
        const text=await r.text(); let j; try{ j=JSON.parse(text); }catch{ j={raw:text}; }
        return json(res,r.status,{domain,label:cfg.label,method,tool:tool||null,http:r.status,result:j});
      }catch(e){ return json(res,502,{domain,label:cfg.label,error:e.message,mcp_url:MCP_URL}); }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.listen(PORT, () => console.log(`Dashboard + AI agent:  http://localhost:${PORT}`));
// Auto-push live DWH data to Vercel every 5 min so Vercel stays live without rebuild
const VERCEL_PUSH_URL = process.env.VERCEL_PUSH_URL || "https://akij-dashboard.vercel.app/api/push-live";
const PUSH_SECRET = process.env.PUSH_SECRET || "b0e0e8da627ada3ba0b8d4ec46f6020a7839e11e66cf3684";
async function pushLiveToVercel(){
  try{
    const dhakaToday=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Dhaka'});
    const liveRes=await fetch(`http://localhost:${PORT}/api/live?date=${dhakaToday}`,{cache:'no-store'});
    const liveData=await liveRes.json();
    if(liveData.fallback || liveData.error){ console.log(`pushLive skip: DWH unreachable for ${dhakaToday}`); return; }
    const r=await fetch(VERCEL_PUSH_URL,{method:"POST", headers:{"Content-Type":"application/json","x-push-secret":PUSH_SECRET}, body: JSON.stringify(liveData)});
    const d=await r.json().catch(()=>({}));
    console.log(`pushLive ${dhakaToday} -> Vercel:`, r.status, d.ok?`ok ${Object.keys(liveData.plants).length} plants` : (d.error||"unknown"));
  }catch(e){ console.error("pushLive failed",e.message); }
}
setTimeout(pushLiveToVercel, 12*1000);
setInterval(pushLiveToVercel, 5*60*1000);
