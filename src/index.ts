// emma-mcp: MCP server exposing emma multi-cloud spot capacity as agent tools.
// Skeleton - implement against @emma-community/emma-typescript-sdk.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "emma-mcp", version: "0.1.0" });

server.tool(
  "search_spot_offers",
  "Search live spot instance configurations across all emma providers, ranked cheapest-first",
  {
    vcpu: z.number().optional(),
    ramGb: z.number().optional(),
    gpuType: z.string().optional(),
    region: z.string().optional(),
    maxPricePerHour: z.number().optional(),
  },
  async (args) => {
    // TODO: call emma SpotInstancesApi configurations endpoint, filter + rank
    return { content: [{ type: "text", text: "not implemented yet" }] };
  }
);

server.tool(
  "provision_spot",
  "Provision a spot instance from a chosen configuration with optional cloud-init",
  { configurationId: z.string(), cloudInit: z.string().optional() },
  async (args) => {
    // TODO: call emma SpotInstancesApi create endpoint
    return { content: [{ type: "text", text: "not implemented yet" }] };
  }
);

server.tool(
  "instance_status",
  "Get the state and connection details of a spot instance",
  { instanceId: z.string() },
  async (args) => {
    // TODO: call emma SpotInstancesApi get endpoint
    return { content: [{ type: "text", text: "not implemented yet" }] };
  }
);

server.tool(
  "destroy_instance",
  "Destroy a spot instance",
  { instanceId: z.string() },
  async (args) => {
    // TODO: call emma SpotInstancesApi delete endpoint
    return { content: [{ type: "text", text: "not implemented yet" }] };
  }
);

await server.connect(new StdioServerTransport());
