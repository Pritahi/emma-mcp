import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { clearDemoSpotInstancesForTests } from "@/lib/demo-spot-lifecycle";
import { createEmmaMcpServer } from "@/mcp/server";

const ENV_NAMES = [
  "EMMA_CLIENT_ID",
  "EMMA_CLIENT_SECRET",
  "EMMA_TOKEN",
  "EMMA_ACCESS_TOKEN",
  "EMMA_DEMO_MODE",
  "PLAN_SIGNING_SECRET",
] as const;
let savedEnv: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>> = {};
let client: Client | undefined;
let server: ReturnType<typeof createEmmaMcpServer> | undefined;

function getText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Expected a text result from the MCP tool.");
  }
  const item = result.content.find((entry: unknown): entry is { type: "text"; text: string } =>
    typeof entry === "object" && entry !== null && "type" in entry && entry.type === "text" && "text" in entry && typeof entry.text === "string",
  );
  if (!item) throw new Error("Expected a text result from the MCP tool.");
  return item.text;
}

function decodeText(result: unknown): Record<string, any> {
  return JSON.parse(getText(result)) as Record<string, any>;
}

async function connectInMemory() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = createEmmaMcpServer();
  client = new Client({ name: "emma-mcp-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ["EMMA_CLIENT_ID", "EMMA_CLIENT_SECRET", "EMMA_TOKEN", "EMMA_ACCESS_TOKEN"]) delete process.env[name];
  process.env.EMMA_DEMO_MODE = "true";
  process.env.PLAN_SIGNING_SECRET = "mcp-test-signing-secret";
  clearDemoSpotInstancesForTests();
});

afterEach(async () => {
  try { await client?.close(); } catch { /* already closed by the linked in-memory transport */ }
  try { await server?.close(); } catch { /* already closed by the linked in-memory transport */ }
  client = undefined;
  server = undefined;
  clearDemoSpotInstancesForTests();
  for (const name of ENV_NAMES) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("emma spot MCP tools", () => {
  it("advertises exactly four tools and completes a clearly simulated spot lifecycle", async () => {
    const connectedClient = await connectInMemory();
    const { tools } = await connectedClient.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "destroy_instance",
      "instance_status",
      "provision_spot",
      "search_spot_offers",
    ]);

    const search = await connectedClient.callTool({
      name: "search_spot_offers",
      arguments: { min_vcpu: 8, min_gpu_count: 1, currency: "USD", limit: 5 },
    });
    expect(search.isError).not.toBe(true);
    const offers = decodeText(search);
    expect(offers.mode).toBe("demo");
    expect(offers.note).toMatch(/preview only/i);
    expect(offers.sshKeys[0].id).toBe("demo-key-01");
    expect(offers.offers.length).toBeGreaterThan(0);

    const selected = offers.offers[0];
    const unconfirmed = await connectedClient.callTool({
      name: "provision_spot",
      arguments: { offer_token: selected.offerToken, ssh_key_id: "demo-key-01", confirmed: false },
    });
    expect(unconfirmed.isError).toBe(true);

    const launched = await connectedClient.callTool({
      name: "provision_spot",
      arguments: { offer_token: selected.offerToken, ssh_key_id: "demo-key-01", confirmed: true },
    });
    expect(launched.isError).not.toBe(true);
    const provision = decodeText(launched);
    expect(provision.mode).toBe("demo");
    expect(provision.benchmark.simulated).toBe(true);
    expect(provision.message).toMatch(/no emma api call, ssh connection, or cloud resource/i);
    const id = provision.instance.id as string;

    const status = await connectedClient.callTool({ name: "instance_status", arguments: { instance_id: id } });
    expect(decodeText(status)).toMatchObject({ id, mode: "demo", sshReady: false });

    const destroyUnconfirmed = await connectedClient.callTool({
      name: "destroy_instance",
      arguments: { instance_id: id, confirmed: false },
    });
    expect(destroyUnconfirmed.isError).toBe(true);

    const destroyed = await connectedClient.callTool({
      name: "destroy_instance",
      arguments: { instance_id: id, confirmed: true },
    });
    expect(decodeText(destroyed)).toMatchObject({ id, destroyed: true, mode: "demo" });

    const missing = await connectedClient.callTool({ name: "instance_status", arguments: { instance_id: id } });
    expect(missing.isError).toBe(true);
  });

  it("does not fall back to synthetic offers when preview mode is disabled", async () => {
    process.env.EMMA_DEMO_MODE = "false";
    const connectedClient = await connectInMemory();
    const result = await connectedClient.callTool({ name: "search_spot_offers", arguments: {} });
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/preview mode is disabled/i);
  });
});
