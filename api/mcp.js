import fs from "fs";
import path from "path";

// Load dashboard data from the HTML file
function loadDashboardData() {
  const htmlPath = path.join(process.cwd(), "index.html");
  if (!fs.existsSync(htmlPath)) {
    return null;
  }
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/(?:const|let) DATA = ({[\s\S]*?});\s*\n?\s*(?:const |let |function |document\.)/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }
  return null;
}

const DATA = loadDashboardData();

export default function handler(req, res) {
  const { method, query } = req;
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  
  if (method === "GET") {
    const plantId = query.plantId;
    const resource = query.resource || "meta";
    
    if (!DATA) {
      res.status(500).json({ error: "Dashboard data not available" });
      return;
    }
    
    if (resource === "meta") {
      res.status(200).json({
        generated: DATA.generated,
        plantCount: DATA.order?.length || 0,
        plants: DATA.order?.map((id) => ({
          id,
          name: DATA.names?.[id] || id,
        })),
      });
    } else if (resource === "summary") {
      const summary = {};
      if (DATA.plants) {
        for (const [id, plant] of Object.entries(DATA.plants)) {
          const daily = plant.daily || [];
          const latest = daily[daily.length - 1];
          summary[id] = {
            name: DATA.names?.[id] || id,
            latestDate: latest?.d,
            oee: latest?.oee,
            yieldPct: latest?.y,
            nptPct: latest?.nptPct,
            dataPoints: daily.length,
          };
        }
      }
      res.status(200).json(summary);
    } else if (resource === "plant" && plantId) {
      const plant = DATA.plants?.[plantId];
      if (!plant) {
        res.status(404).json({ 
          error: `Plant '${plantId}' not found`,
          available: DATA.order 
        });
      } else {
        res.status(200).json(plant);
      }
    } else {
      res.status(400).json({ 
        error: "Invalid resource",
        usage: {
          meta: "?resource=meta",
          summary: "?resource=summary",
          plant: "?resource=plant&plantId=accl"
        }
      });
    }
  } else if (method === "POST") {
    // MCP protocol endpoint
    const body = req.body || {};
    
    if (body.jsonrpc === "2.0") {
      // Handle MCP JSON-RPC request
      const { id, method: rpcMethod, params } = body;
      
      if (rpcMethod === "initialize") {
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              resources: { listChanged: false },
              tools: { listChanged: false }
            },
            serverInfo: {
              name: "akij-dashboard",
              version: "1.0.0"
            }
          }
        });
      } else if (rpcMethod === "resources/list") {
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "dashboard://meta",
                name: "Dashboard Metadata",
                description: "Metadata about all plants and data generation time",
                mimeType: "application/json"
              },
              {
                uri: "dashboard://summary",
                name: "Plants Summary",
                description: "Summary of OEE, yield, NPT for all plants",
                mimeType: "application/json"
              },
              {
                uri: "enterprise://domains",
                name: "Enterprise MCP Domains",
                description: "List of ARL MCP domains available via /api/proxy (Finance, Procurement, WMS, MES, OMS, Import, Asset, TMS, RTM, Costing, Partners, Items)",
                mimeType: "application/json"
              }
            ]
          }
        });
      } else if (rpcMethod === "resources/read") {
        const { uri } = params;
        let data;
        
        if (uri === "dashboard://meta") {
          data = {
            generated: DATA?.generated,
            plantCount: DATA?.order?.length || 0,
            plants: DATA?.order?.map((id) => ({
              id,
              name: DATA?.names?.[id] || id,
            })),
          };
        } else if (uri === "dashboard://summary") {
          const summary = {};
          if (DATA?.plants) {
            for (const [id, plant] of Object.entries(DATA.plants)) {
              const daily = plant.daily || [];
              const latest = daily[daily.length - 1];
              summary[id] = {
                name: DATA.names?.[id] || id,
                latestDate: latest?.d,
                oee: latest?.oee,
                yieldPct: latest?.y,
                nptPct: latest?.nptPct,
              };
            }
          }
          data = summary;
        } else if (uri === "enterprise://domains") {
          data = {
            mcp_url: process.env.ARL_MCP_URL || "https://arl-mcp.ibos.io/mcp",
            proxy: "/api/proxy",
            domains: [
              { domain: "finance", label: "Finance" },
              { domain: "procurement", label: "Procurement" },
              { domain: "wms", label: "Warehouse (WMS)" },
              { domain: "mes", label: "Manufacturing (MES)" },
              { domain: "oms", label: "Order (OMS)" },
              { domain: "import", label: "Import/Commercial" },
              { domain: "asset", label: "Asset" },
              { domain: "tms", label: "Transport (TMS)" },
              { domain: "rtm", label: "RTM" },
              { domain: "cost", label: "Costing" },
              { domain: "partner", label: "Partners" },
              { domain: "item", label: "Items" },
            ],
          };
        } else if (uri.startsWith("dashboard://plant/")) {
          const plantId = uri.split("/")[2];
          data = DATA?.plants?.[plantId] || { error: `Plant '${plantId}' not found` };
        } else {
          res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Resource not found" } });
          return;
        }
        
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2)
            }]
          }
        });
      } else if (rpcMethod === "tools/list") {
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "get_plant_summary",
                description: "Get OEE, yield, NPT summary for a specific plant",
                inputSchema: {
                  type: "object",
                  properties: {
                    plantId: { type: "string", description: "Plant ID (e.g. accl, apfil)" }
                  },
                  required: ["plantId"]
                }
              },
              {
                name: "get_all_plants",
                description: "Get OEE overview for all plants",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "enterprise_domains",
                description: "List available ARL enterprise MCP domains (Finance, Procurement, WMS, MES, OMS, Import, Asset, TMS, RTM, Costing, Partners, Items)",
                inputSchema: { type: "object", properties: {} }
              },
              {
                name: "proxy_enterprise",
                description: "Proxy a call to an ARL MCP domain. domain in finance|procurement|wms|mes|oms|import|asset|tms|rtm|cost|partner|item. method in tools/list|resources/list|resources/read|tools/call",
                inputSchema: {
                  type: "object",
                  properties: {
                    domain: { type: "string", description: "Which domain (finance, mes, wms, ...)" },
                    method: { type: "string", description: "tools/list, resources/list, resources/read, tools/call" },
                    tool: { type: "string", description: "Tool name when method=tools/call" },
                    uri: { type: "string", description: "Resource URI when method=resources/read" },
                    args: { type: "object", description: "Arguments for tools/call" }
                  },
                  required: ["domain"]
                }
              }
            ]
          }
        });
      } else if (rpcMethod === "tools/call") {
        const { name, arguments: args } = params;
        
        if (name === "get_plant_summary") {
          const plant = DATA?.plants?.[args.plantId];
          if (!plant) {
            res.status(200).json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: `Plant '${args.plantId}' not found` }]
              }
            });
          } else {
            const daily = plant.daily || [];
            const latest = daily[daily.length - 1];
            res.status(200).json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    plant: plant.meta?.name,
                    latest: { date: latest?.d, oee: latest?.oee, yield: latest?.y },
                    totalDays: daily.length
                  }, null, 2)
                }]
              }
            });
          }
        } else if (name === "get_all_plants") {
          const overview = DATA?.order?.map((id) => {
            const p = DATA.plants?.[id];
            const daily = p?.daily || [];
            const latest = daily[daily.length - 1];
            return { id, name: DATA.names?.[id], oee: latest?.oee, yield: latest?.y };
          }) || [];
          res.status(200).json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(overview, null, 2) }]
            }
          });
        } else if (name === "enterprise_domains") {
          res.status(200).json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify({
                mcp_url: process.env.ARL_MCP_URL || "https://arl-mcp.ibos.io/mcp",
                proxy: "/api/proxy",
                domains: [
                  "finance","procurement","wms","mes","oms","import","asset","tms","rtm","cost","partner","item"
                ]
              }, null, 2) }]
            }
          });
        } else if (name === "proxy_enterprise") {
          // Forward to /api/proxy
          const { domain, method = "tools/list", tool, uri, args = {} } = args || {};
          if (!domain) {
            res.status(200).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "domain required" } });
            return;
          }
          const url = new URL("/api/proxy", "http://x");
          url.searchParams.set("domain", domain);
          url.searchParams.set("method", method);
          if (tool) url.searchParams.set("tool", tool);
          if (uri) url.searchParams.set("uri", uri);
          url.searchParams.set("args", JSON.stringify(args));
          try {
            const pr = await fetch(url.toString()); // forward within same origin
            const pj = await pr.json();
            res.status(200).json({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: JSON.stringify(pj, null, 2) }]
              }
            });
          } catch (e) {
            res.status(200).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "proxy failed: " + e.message } });
          }
        } else {
          res.status(200).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Tool '${name}' not found` }
          });
        }
      } else {
        res.status(200).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method '${rpcMethod}' not found` }
        });
      }
    } else {
      res.status(400).json({ error: "Invalid JSON-RPC request" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
