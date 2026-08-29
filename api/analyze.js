export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method==="OPTIONS"){ res.status(200).end(); return; }
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  let body=req.body;
  if(!body || typeof body==="string"){ try{ body=JSON.parse(body||"{}"); }catch{ body={}; } }
  if(!body.period || !body.period.from || !body.period.to) return res.status(400).json({error:"period.from/to required"});
  const key=process.env.DEEPSEEK_API_KEY;
  if(!key) return res.status(200).json({offline:true, reason:"no API key configured — using built-in analyst engine"});
  try{
    const SYSTEM_PROMPT=`You are a senior manufacturing performance analyst for Akij Group (Deputy COO Control Tower, Bangladesh — 15 plants, cement, fiber, feed, flour, ispat, building, rice).
You receive a JSON of computed KPIs for a date range plus previous period and deltas. Write a crisp professional HTML fragment ONLY (no markdown fences, no <html>/<head>/<body>, no <script>). Structure with <h3> headings and a <table> for key metrics (border-collapse, 1px #ccc, th bg #eef4f3, font-size 13px): 1. Executive Summary (3-5 li) 2. Key Metrics vs Previous Period (table: Metric | Value | Change | Assessment) 3. OEE & Capacity Commentary 4. Losses & Breakdown Analysis 5. Maintenance Effectiveness 6. Planning & Output 7. Recommendations (numbered, actionable). Use ৳ for BDT, thousands separators, % for percentages. Keep under 900 words.`;
    const r=await fetch("https://api.deepseek.com/chat/completions",{method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer "+key}, body:JSON.stringify({model:"deepseek-chat", temperature:0.4, max_tokens:3500, messages:[{role:"system", content:SYSTEM_PROMPT},{role:"user", content:"Analyze this Deputy COO Control Tower data:\n"+JSON.stringify(body)}]})});
    const d=await r.json();
    if(!r.ok) throw new Error("DeepSeek "+r.status+": "+(d.error&&d.error.message||"failed"));
    const html=d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content;
    if(!html) throw new Error("Empty AI response");
    const sanitize=h=>String(h).replace(/<script[\s\S]*?<\/script>/gi,"").replace(/ on\w+="[^"]*"/gi,"").replace(/javascript:/gi,"");
    return res.status(200).json({html:sanitize(html)});
  }catch(e){
    if(/401|Authentication|invalid/i.test(e.message)) return res.status(200).json({offline:true, reason:"API key invalid/expired — using built-in analyst engine"});
    return res.status(200).json({offline:true, reason:e.message+" — using built-in analyst engine"});
  }
}
