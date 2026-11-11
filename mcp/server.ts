#!/usr/bin/env node
import { loadEnvConfig } from "@next/env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { createSpotOfferToken, verifySpotOfferToken } from "@/lib/crypto";
import { DEMO_SSH_KEYS, DEMO_SPOT_OFFERS } from "@/lib/demo-data";
import { fetchSshKeys } from "@/lib/emma";
import { demoModeAllowed, hasEmmaCredentials } from "@/lib/status";
import { filterAndRankSpotOffers, fetchLiveSpotOffers } from "@/lib/spot-offers";
import { deleteLiveSpotInstance, fetchLiveSpotStatus } from "@/lib/spot-instances";
import { createDemoSpotInstance, destroyDemoSpotInstance, getDemoSpotStatus } from "@/lib/demo-spot-lifecycle";
import { buildSpotInitScript, provisionLiveSpotAndBenchmark } from "@/lib/spot-lifecycle";
import { loadSshAuthConfig } from "@/lib/ssh-benchmark";
import type { SpotSearchFilters } from "@/lib/types";

loadEnvConfig(process.cwd());

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected emma spot lifecycle error.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function resolveFilters(input: {
  min_vcpu?: number;
  min_ram_gb?: number;
  min_gpu_count?: number;
  gpu_type?: string;
  region?: string;
  max_price_per_hour?: number;
  currency?: string;
  limit?: number;
}): SpotSearchFilters {
  const currency = input.currency?.trim().toUpperCase()
    || (input.max_price_per_hour !== undefined ? "USD" : undefined);
  return {
    minVcpu: input.min_vcpu,
    minRamGb: input.min_ram_gb,
    minGpuCount: input.min_gpu_count ?? (input.gpu_type ? 1 : undefined),
    gpuType: input.gpu_type?.trim() || undefined,
    region: input.region?.trim() || undefined,
    maxPricePerHour: input.max_price_per_hour,
    currency,
    limit: input.limit ?? 10,
  };
}

function validateBid(offerToken: ReturnType<typeof verifySpotOfferToken>, requestedBid?: number): number {
  const bid = requestedBid ?? offerToken.offer.pricePerHour;
  if (!Number.isFinite(bid) || bid <= 0) throw new Error("bid_price_per_hour must be a positive number.");
  if (bid < offerToken.offer.pricePerHour) {
    throw new Error(`The bid (${bid} ${offerToken.offer.currency}/hr) is below the selected offer's current price (${offerToken.offer.pricePerHour} ${offerToken.offer.currency}/hr). Search again or raise the bid.`);
  }
  const max = offerToken.filters.maxPricePerHour;
  if (max !== undefined && bid > max) {
    throw new Error(`The bid (${bid} ${offerToken.offer.currency}/hr) exceeds the signed search ceiling (${max} ${offerToken.offer.currency}/hr). Run search_spot_offers with a higher budget if you want to proceed.`);
  }
  if (offerToken.filters.currency && offerToken.offer.currency.toUpperCase() !== offerToken.filters.currency.toUpperCase()) {
    throw new Error("The selected offer currency does not match the signed search currency. Run search_spot_offers again.");
  }
  return bid;
}

export function createEmmaMcpServer(): McpServer {
  const server = new McpServer({ name: "emma-mcp", version: "1.0.0" });

  server.tool(
    "search_spot_offers",
    "Search emma's live Linux SPOT compute catalog and return cheapest-first offers matching minimum vCPU/RAM/GPU, region and optional maximum hourly price. Pass the structured constraints inferred from the user's prompt. Only Linux offers are returned because provisioning runs a bash init script and SSH benchmark. Prices are provider-reported; no currency conversion is performed. In preview mode, returns clearly labeled synthetic offers and a synthetic demo SSH key. Read-only.",
    {
      min_vcpu: z.number().int().min(1).max(512).optional().describe("Minimum virtual CPU cores."),
      min_ram_gb: z.number().int().min(1).max(32768).optional().describe("Minimum RAM in GB."),
      min_gpu_count: z.number().int().min(1).max(32).optional().describe("Minimum number of GPUs. If gpu_type is set and this is omitted, it defaults to 1."),
      gpu_type: z.string().trim().min(1).max(80).optional().describe("GPU model/type substring, e.g. NVIDIA T4 or A100."),
      region: z.string().trim().min(1).max(100).optional().describe("Country, city, cloud region or continent substring, e.g. Germany, Northern Virginia or Europe."),
      max_price_per_hour: z.number().positive().max(100_000).optional().describe("Maximum hourly spot bid in the selected currency."),
      currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional().describe("ISO currency for price filtering/ranking (USD/EUR/GBP). Defaults to USD when max_price_per_hour is set. No FX conversion is done."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum number of ranked offers to return; defaults to 10."),
    },
    async (input) => {
      try {
        const filters = resolveFilters(input);
        const live = hasEmmaCredentials();
        if (!live && !demoModeAllowed()) throw new Error("Preview mode is disabled and live emma credentials are not configured.");

        const [catalog, sshKeys] = live
          ? await Promise.all([fetchLiveSpotOffers(filters), fetchSshKeys()]).then(([result, keys]) => [result, keys] as const)
          : [{ offers: DEMO_SPOT_OFFERS, catalogCount: DEMO_SPOT_OFFERS.length } as const, DEMO_SSH_KEYS] as const;
        const mode = live ? "live" : "demo";
        const ranked = filterAndRankSpotOffers(catalog.offers, filters);
        const offers = ranked.slice(0, filters.limit).map((offer) => ({
          ...offer,
          bidPricePerHour: offer.pricePerHour,
          offerToken: createSpotOfferToken({ mode, filters, offer }),
        }));
        const currencyNote = filters.currency
          ? `Ranked by hourly price in ${filters.currency}; prices are not converted.`
          : "Offers are grouped by native currency and ranked cheapest-first within each currency group; prices are not converted.";
        return textResult({
          mode,
          filters,
          catalogCount: catalog.catalogCount,
          pricedCatalogCount: catalog.offers.length,
          matchCount: ranked.length,
          returnedCount: offers.length,
          ranking: filters.currency ? "hourly_price_ascending" : "native_currency_groups_then_hourly_price_ascending",
          note: live
            ? `Live spot configurations from emma. ${currencyNote} Current market prices can change before provisioning.`
            : `Preview only: sample offer catalog. No emma API was contacted. ${currencyNote}`,
          sshKeys: sshKeys.map(({ id, name, fingerprint, keyType, source }) => ({ id, name, fingerprint, keyType, source })),
          offers,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    "provision_spot",
    "Create the exact signed spot offer, attach the selected emma SSH key and a cloud-init initScript, wait for SSH, and run a short curl timing benchmark using ssh2. Requires confirmed=true after the user approves provider, region, size, hourly bid, SSH key, and any supplied init_script. Linux-only because the server sends a bash cloud-init script. On benchmark failure the server automatically attempts deletion; on success the spot remains billable until destroy_instance is called. Preview mode simulates provisioning and benchmark output without SSH or cloud calls.",
    {
      offer_token: z.string().min(20).max(20_000).describe("Signed offerToken returned by search_spot_offers."),
      ssh_key_id: z.union([z.number().int().positive(), z.string().trim().min(1).max(120)]).describe("SSH key ID shown in search_spot_offers.sshKeys. For live mode, use a key whose private half is available to this MCP process."),
      name: z.string().trim().min(1).max(63).optional().describe("Spot instance name. Defaults to emma-spot-benchmark."),
      init_script: z.string().max(9_500).optional().describe("Optional bash initialization script; emma executes it via cloud-init. The server prepends a small curl bootstrap for the benchmark."),
      bid_price_per_hour: z.number().positive().max(100_000).optional().describe("Hourly spot bid. Defaults to the selected offer price and cannot exceed a signed max_price_per_hour."),
      security_group_id: z.number().int().positive().optional().describe("Optional emma security group ID; otherwise emma applies the network's default group."),
      confirmed: z.boolean().describe("Must be true only after the user explicitly approves this exact cloud creation and price."),
    },
    async (input) => {
      try {
        if (!input.confirmed) throw new Error("Provisioning was not confirmed. Show the selected offer, hourly bid and SSH key, then ask the user before retrying with confirmed=true.");
        const signed = verifySpotOfferToken(input.offer_token);
        if (signed.mode === "demo") {
          if (!demoModeAllowed()) throw new Error("Preview mode is disabled.");
          const keyAvailable = DEMO_SSH_KEYS.some((key) => String(key.id) === String(input.ssh_key_id));
          if (!keyAvailable) throw new Error("For preview mode, select the synthetic showcase SSH key demo-key-01 from search_spot_offers.sshKeys.");
          const bid = validateBid(signed, input.bid_price_per_hour);
          const result = createDemoSpotInstance({ offer: signed.offer, name: input.name ?? "emma-spot-benchmark" });
          return textResult({
            ...result,
            pricePerHour: bid,
            currency: signed.offer.currency,
            initScript: "simulated; not executed",
          });
        }

        if (!hasEmmaCredentials()) throw new Error("This is a live offer, but emma credentials are no longer configured. Search again after reconnecting.");
        const numericKeyId = Number(input.ssh_key_id);
        if (!Number.isSafeInteger(numericKeyId) || numericKeyId <= 0) throw new Error("Live emma SSH key IDs must be positive numeric IDs.");
        const keys = await fetchSshKeys();
        if (!keys.some((key) => String(key.id) === String(numericKeyId))) {
          throw new Error("That SSH key is not visible to this emma Service App. Use an ID listed by search_spot_offers.");
        }
        const auth = await loadSshAuthConfig();
        const bid = validateBid(signed, input.bid_price_per_hour);
        const initScript = buildSpotInitScript(input.init_script);
        const result = await provisionLiveSpotAndBenchmark({
          offer: signed.offer,
          name: input.name ?? "emma-spot-benchmark",
          sshKeyId: numericKeyId,
          pricePerHour: bid,
          initScript,
          securityGroupId: input.security_group_id,
          auth,
        });
        return textResult({
          ...result,
          mode: "live",
          pricePerHour: bid,
          currency: signed.offer.currency,
          sshKey: keys.find((key) => String(key.id) === String(numericKeyId))?.name,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    "instance_status",
    "Get a spot instance's current emma state and network details, including public/private IP addresses and a ready-to-copy SSH command when available. Supports both live emma IDs and demo IDs returned by provision_spot. Read-only.",
    {
      instance_id: z.string().trim().min(1).max(64).describe("Spot instance ID returned by provision_spot."),
    },
    async ({ instance_id }) => {
      try {
        if (instance_id.startsWith("demo-spot-")) return textResult(getDemoSpotStatus(instance_id));
        if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required to check this spot instance.");
        return textResult(await fetchLiveSpotStatus(instance_id));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    "destroy_instance",
    "Permanently delete a live emma spot instance or remove a simulated demo instance. This is destructive; require confirmed=true after the user requests teardown. A successful provision_spot response includes the exact ID to pass here.",
    {
      instance_id: z.string().trim().min(1).max(64).describe("Spot instance ID returned by provision_spot."),
      confirmed: z.boolean().describe("Must be true only when the user has requested deletion/cleanup of this exact instance."),
    },
    async ({ instance_id, confirmed }) => {
      try {
        if (!confirmed) throw new Error("Deletion was not confirmed. Ask the user before retrying with confirmed=true.");
        if (instance_id.startsWith("demo-spot-")) return textResult(destroyDemoSpotInstance(instance_id));
        if (!hasEmmaCredentials()) throw new Error("Live emma credentials are required to delete this spot instance.");
        await deleteLiveSpotInstance(instance_id);
        return textResult({ id: instance_id, destroyed: true, mode: "live", message: "emma accepted the spot deletion request." });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

async function main() {
  const server = createEmmaMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("emma-mcp connected over stdio with exactly four spot lifecycle tools.");
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("emma-mcp failed to start:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
