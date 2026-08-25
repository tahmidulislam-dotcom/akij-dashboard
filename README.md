# Akij Dashboard MCP Server

Remote MCP server for accessing Akij Group production & maintenance dashboard data.

## Live Dashboard
**https://akij-dashboard-deploy.vercel.app**

## MCP Endpoint
**https://akij-dashboard-deploy.vercel.app/api/mcp**

## Available Resources

### GET /api/mcp?resource=meta
Metadata about all plants and data generation time.

### GET /api/mcp?resource=summary
Summary of OEE, yield, NPT for all 15 plants.

### GET /api/mcp?resource=plant&plantId={id}
Detailed data for a specific plant.

**Available Plant IDs:**
- `accl` - Akij Cement Company Ltd. (ACCL)
- `apfil` - Akij Poly Fibre Industries Ltd.
- `aafl` - Akij Agro Feed Ltd.
- `aelflour` - Akij Essentials Ltd. (Flour Mills)
- `aeldal` - Akij Essentials Ltd. (Daal)
- `ail` - Akij Ispat Ltd.
- `absl` - Akij Building Solutions Ltd.
- `armcl-ngnj` - ARMCL (Nganj)
- `armcl-dhour` - ARMCL (Dhour)
- `armcl-rup` - ARMCL (Rup)
- `armcl-ctg` - ARMCL (Chattogram)
- `armcl-gaz` - ARMCL (Gazipur)
- `hrml` - Hashem Rice Mill Ltd.
- `fal` - Fariq Auto Ltd.
- `alel` - Akij Light Engineering Ltd.

## MCP JSON-RPC Protocol

The server supports MCP JSON-RPC 2.0 protocol via POST requests.

### Initialize
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

### List Resources
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {}
}
```

### Read Resource
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/read",
  "params": {
    "uri": "dashboard://meta"
  }
}
```

### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/list",
  "params": {}
}
```

### Call Tool
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_plant_summary",
    "arguments": {
      "plantId": "accl"
    }
  }
}
```

## opencode.json Configuration

Add this to your `opencode.json` to connect to the MCP server:

```json
{
  "mcp": {
    "akij-dashboard": {
      "type": "remote",
      "url": "https://akij-dashboard-deploy.vercel.app/api/mcp",
      "enabled": true
    }
  }
}
```

## Data
- 15 plants across Bangladesh
- Daily production data from 2023-02-04 to 2026-08-25
- OEE, yield, NPT, downtime breakdown, overtime, MOH data
- Data refreshed daily from MSSQL DWH
