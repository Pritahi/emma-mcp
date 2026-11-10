#!/usr/bin/env node
import { loadEnvConfig } from "@next/env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

loadEnvConfig(process.cwd());
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildLivePlan } from "@/lib/planner";
import { fetchSshKeys, fetchVirtualMachines } from "@/lib/emma";
import { normalizeVm } from "@/lib/normalize";
import { verifyPlanToken } from "@/lib/crypto";
import { provisionFromPlan } from "@/lib/provision";
import { hasEmmaCredentials } from "@/lib/status";

const server = new McpServer({
  name: "emma-mcp",
  version: "1.0.0",
});

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected emma MCP error.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

server.tool(
  "search_compute",
  "Parse a natural-language VM request and compare matching, live emma configurations across connected cloud providers. This is read-only and returns short-lived plan tokens.",
  { prompt: z.string().min(8).max(500) },
  async ({ prompt }) => {
    try {
      if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required for MCP. Set EMMA_CLIENT_ID and EMMA_CLIENT_SECRET (or EMMA_TOKEN). Demo data is web-preview only.");
      const result = await buildLivePlan(prompt);
      return textResult({
        mode: result.mode,
        intent: result.intent,
        matchCount: result.matchCount,
        catalogCount: result.catalogCount,
        note: result.note,
        offers: result.offers.map(({ planToken, ...offer }) => ({ ...offer, planToken })),
      });
    } catch (error) { return errorResult(error); }
  },
);

server.tool(
  "list_ssh_keys",
  "List SSH public-key references visible to the configured emma Service App. Use a key ID from this result when provisioning a Linux VM.",
  async () => {
    try {
      if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required for MCP.");
      return textResult(await fetchSshKeys());
    } catch (error) { return errorResult(error); }
  },
);

server.tool(
  "list_vms",
  "List virtual machines in the configured emma project. This is read-only.",
  async () => {
    try {
      if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required for MCP.");
      return textResult((await fetchVirtualMachines()).map(normalizeVm));
    } catch (error) { return errorResult(error); }
  },
);

server.tool(
  "provision_vm",
  "Create the exact VM in a signed, unexpired emma plan. Before calling, show the provider, region, resources, cost and SSH key to the user; only set confirmed=true after explicit approval. This is a billable cloud action.",
  {
    planToken: z.string().min(20).max(20_000).describe("Short-lived planToken returned by search_compute."),
    sshKeyId: z.number().int().positive().describe("SSH key ID from list_ssh_keys."),
    name: z.string().min(1).max(63).describe("VM name, 1–63 characters."),
    confirmed: z.boolean().describe("Must be true only after the user explicitly confirms this exact plan."),
  },
  async ({ planToken, sshKeyId, name, confirmed }) => {
    try {
      if (!confirmed) throw new Error("Provisioning was not confirmed. Show the complete plan and ask the user first.");
      if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required for MCP.");
      const plan = verifyPlanToken(planToken);
      if (plan.mode !== "live") throw new Error("Only live emma plans can be provisioned through MCP.");
      const keys = await fetchSshKeys();
      if (!keys.some((key) => String(key.id) === String(sshKeyId))) throw new Error("That SSH key is not visible to this Service App. Run list_ssh_keys and select an available key.");
      const vm = await provisionFromPlan({ offer: plan.offer, name, sshKeyId, mode: "live", osId: plan.offer.osId });
      return textResult(vm);
    } catch (error) { return errorResult(error); }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("emma-mcp connected over stdio. Provisioning is gated by an explicit confirmed=true tool call.");
}

main().catch((error: unknown) => {
  console.error("emma-mcp failed to start:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
