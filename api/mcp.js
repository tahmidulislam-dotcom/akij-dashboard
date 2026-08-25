import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import fs from "fs";
import path from "path";

// Load dashboard data from the HTML file
function loadDashboardData() {
  const htmlPath = path.join(process.cwd(), "index.html");
  if (!fs.existsSync(htmlPath)) {
    return null;
  }
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/const DATA = ({[\s\S]*?});\s*\n?\s*(?:const |function |document\.)/);
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

const server = new McpServer({
  name: "akij-dashboard",
  version: "1.0.0",
});

// Resource: Dashboard metadata
server.resource("dashboard-meta", "dashboard://meta", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        generated: DATA?.generated,
        plantCount: DATA?.order?.length || 0,
        plants: DATA?.order?.map((id) => ({
          id,
          name: DATA.names?.[id] || id,
          dateRange: DATA.plants?.[id]?.meta
            ? { from: DATA.plants[id].meta.minDate, to: DATA.plants[id].meta.maxDate }
            : null,
        })),
      }),
    },
  ],
}));

// Resource: All plants summary
server.resource("plants-summary", "dashboard://summary", async (uri) => {
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
        dataPoints: daily.length,
      };
    }
  }
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(summary, null, 2),
      },
    ],
  };
});

// Resource: Specific plant data
server.resource(
  "plant-data",
  "dashboard://plant/{plantId}",
  async (uri, { plantId }) => {
    const plant = DATA?.plants?.[plantId];
    if (!plant) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: `Plant '${plantId}' not found`, available: DATA?.order }),
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(plant, null, 2),
        },
      ],
    };
  }
);

// Tool: Get plant summary
server.tool(
  "get_plant_summary",
  "Get OEE, yield, NPT summary for a specific plant",
  { plantId: z.string().describe("Plant ID (e.g. accl, apfil, ael)") },
  async ({ plantId }) => {
    const plant = DATA?.plants?.[plantId];
    if (!plant) {
      return {
        content: [{ type: "text", text: `Plant '${plantId}' not found. Available: ${DATA?.order?.join(", ")}` }],
      };
    }
    const meta = plant.meta;
    const daily = plant.daily || [];
    const latest = daily[daily.length - 1];
    const avg = daily.length
      ? {
          oee: (daily.reduce((s, r) => s + (r.oee || 0), 0) / daily.length).toFixed(1),
          yield: (daily.reduce((s, r) => s + (r.y || 0), 0) / daily.length).toFixed(1),
          npt: (daily.reduce((s, r) => s + (r.nptPct || 0), 0) / daily.length).toFixed(1),
        }
      : {};
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              plant: meta.name,
              plants: meta.plants,
              dateRange: { from: meta.minDate, to: meta.maxDate },
              latest: { date: latest?.d, oee: latest?.oee, yield: latest?.y, npt: latest?.nptPct },
              averages: avg,
              totalDays: daily.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Get all plants overview
server.tool("get_all_plants", "Get OEE overview for all plants", {}, async () => {
  if (!DATA?.plants) {
    return { content: [{ type: "text", text: "No dashboard data available" }] };
  }
  const overview = DATA.order.map((id) => {
    const p = DATA.plants[id];
    const daily = p?.daily || [];
    const latest = daily[daily.length - 1];
    return {
      id,
      name: DATA.names?.[id] || id,
      oee: latest?.oee,
      yield: latest?.y,
      npt: latest?.nptPct,
      date: latest?.d,
    };
  });
  return {
    content: [{ type: "text", text: JSON.stringify(overview, null, 2) }],
  };
});

// Tool: Get downtime breakdown
server.tool(
  "get_downtime_breakdown",
  "Get NPT breakdown by reason for a plant",
  { plantId: z.string().describe("Plant ID") },
  async ({ plantId }) => {
    const plant = DATA?.plants?.[plantId];
    if (!plant) {
      return { content: [{ type: "text", text: `Plant '${plantId}' not found` }] };
    }
    const bd = plant.nptBd || {};
    return {
      content: [{ type: "text", text: JSON.stringify(bd, null, 2) }],
    };
  }
);

export default async function handler(req, res) {
  if (req.method === "POST") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, req.body, res);
  } else if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    res.send(
      `<html><body><h1>Akij Dashboard MCP Server</h1><p>MCP endpoint: POST /api/mcp</p><p>Data generated: ${DATA?.generated || "N/A"}</p><p>Plants: ${DATA?.order?.join(", ") || "N/A"}</p></body></html>`
    );
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
