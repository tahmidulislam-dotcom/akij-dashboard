export default function handler(req, res) {
  res.status(200).json({ 
    message: "Akij Dashboard MCP Server",
    status: "running",
    timestamp: new Date().toISOString()
  });
}
