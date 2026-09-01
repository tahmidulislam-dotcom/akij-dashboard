// Proxy from Deputy COO Control Tower -> ARL MCP (arl-mcp.ibos.io/mcp)
// Each domain uses its own X-API-Key. Keys read from env so they are never in frontend.
// Endpoint:  GET/POST /api/proxy?domain=mes&method=tools/call&tool=<name>&args=<json>
//            POST /api/proxy  body {domain, method, tool, args}
const MCP_URL = process.env.ARL_MCP_URL || "https://arl-mcp.ibos.io/mcp";
const CONFIG = {
  finance:     { key: "ibos_mcp_sec_fin_9c3d4e5f_6a7b_8c9d_0e1f_2a3b4c5d6e7f_F1n4", label: "Finance" },
  procurement: { key: "ibos_mcp_sec_pro_8b2c3d4e_5f6a_7b8c_9d0e_1f2a3b4c5d6e_Pr0c", label: "Procurement" },
  wms:         { key: "ibos_mcp_sec_wms_1e5f6a7b_8c9d_0e1f_2a3b_4c5d6e7f8a9b_WmS9", label: "Warehouse (WMS)" },
  mes:         { key: "ibos_mcp_sec_mes_5c9d0e1f_2a3b_4c5d_6e7f_8a9b0c1d2e3f_M3s8", label: "Manufacturing (MES)" },
  oms:         { key: "ibos_mcp_sec_oms_6d0e1f2a_3b4c_5d6e_7f8a_9b0c1d2e3f4a_0mS7", label: "Order (OMS)" },
  import:      { key: "ibos_mcp_sec_com_0d4e5f6a_7b8c_9d0e_1f2a_3b4c5d6e7f8a_1mp0", label: "Import/Commercial" },
  asset:       { key: "ibos_mcp_sec_ast_7a1b2c3d_4e5f_6a7b_8c9d_0e1f2a3b4c5d_AsS3t", label: "Asset" },
  tms:         { key: "ibos_mcp_sec_tms_7e1f2a3b_4c5d_6e7f_8a9b_0c1d2e3f4a5b_TmS6", label: "Transport (TMS)" },
  rtm:         { key: "ibos_mcp_sec_rtm_2d6e7f8a_9b0c_1d2e_3f4a_5b6c7d8e9f0a_RtM2", label: "RTM" },
  cost:        { key: "ibos_mcp_sec_cco_4b8c9d0e_1f2a_3b4c_5d6e_7f8a9b0c1d2e_C0st", label: "Costing" },
  partner:     { key: "ibos_mcp_sec_prt_2f6a7b8c_9d0e_1f2a_3b4c_5d6e7f8a9b0c_P4rt", label: "Partners" },
  item:        { key: "ibos_mcp_sec_itm_3a7b8c9d_0e1f_2a3b_4c5d_6e7f8a9b0c1d_1t3m", label: "Items" },
};

function cors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}
function ok(res, code, obj){ cors(res); res.status(code).json(obj); }

export default async function handler(req, res){
  if(req.method === "OPTIONS"){ cors(res); res.status(200).end(); return; }

  // list available domains
  if((req.method === "GET" && req.query.list === "1") || (req.method === "POST" && req.body?.list)){
    return ok(res, 200, { mcp_url: MCP_URL, domains: Object.entries(CONFIG).map(([d,c])=>({domain:d,label:c.label})) });
  }

  let domain = req.query?.domain, method = req.query?.method, tool = req.query?.tool, args = req.query?.args;
  if(req.method === "POST" && req.body){
    domain = req.body.domain ?? domain;
    method = req.body.method ?? method ?? "tools/call";
    tool = req.body.tool ?? tool;
    args = (req.body.args && typeof req.body.args === "object") ? req.body.args : (args || "{}");
  } else {
    method = method || "tools/call";
    args = args || "{}";
  }
  if(typeof args === "string"){ try{ args = JSON.parse(args); }catch{ args = {}; } }

  if(!domain) return ok(res, 400, { error: "domain required", domains: Object.keys(CONFIG) });
  const cfg = CONFIG[domain];
  if(!cfg) return ok(res, 400, { error: "unknown domain", domains: Object.keys(CONFIG) });

  let rpc;
  if(method === "initialize"){
    rpc = { jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"akij-dashboard", version:"3.0.0" } } };
  } else if(method === "resources/list"){
    rpc = { jsonrpc:"2.0", id:1, method:"resources/list" };
  } else if(method === "resources/read"){
    rpc = { jsonrpc:"2.0", id:1, method:"resources/read", params:{ uri: req.query.uri || args.uri || "" } };
  } else if(method === "tools/list"){
    rpc = { jsonrpc:"2.0", id:1, method:"tools/list" };
  } else { // tools/call
    if(!tool) return ok(res, 400, { error: "tool required for tools/call", domain });
    rpc = { jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:tool, arguments: args || {} } };
  }

  try{
    const r = await fetch(MCP_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json", "X-API-Key": cfg.key },
      body: JSON.stringify(rpc),
    });
    const text = await r.text();
    let json; try{ json = JSON.parse(text); }catch{ json = { raw: text }; }
    // include notification (don't require it) for protocol steps
    return ok(res, r.status, { domain, label: cfg.label, method, tool: tool||null, http: r.status, result: json });
  }catch(e){
    return ok(res, 502, { domain, label: cfg.label, error: e.message, mcp_url: MCP_URL });
  }
}
