import type { SpotBenchmarkResult, SpotInstanceStatus, SpotOffer } from "@/lib/types";
import { createLiveSpotInstance, deleteLiveSpotInstance, fetchLiveSpotStatus, getSpotResourceId } from "@/lib/spot-instances";
import { isPermanentSshError, runSpotSshBenchmark, type SshAuthConfig } from "@/lib/ssh-benchmark";

const BENCHMARK_BOOTSTRAP = `#!/usr/bin/env bash
set -eu
if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q curl
  else
    echo "curl is missing and no supported package manager was found" >&2
    exit 127
  fi
fi`;

function envDuration(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export function buildSpotInitScript(customScript?: string): string {
  const custom = customScript?.trim().replace(/^#![^\n]*\n/, "") ?? "";
  const combined = custom
    ? `${BENCHMARK_BOOTSTRAP}\n\n# User-supplied initialization script\n${custom}`
    : BENCHMARK_BOOTSTRAP;
  if (combined.length > 10_000) {
    throw new Error(`The combined cloud-init initScript is ${combined.length} characters; emma allows at most 10,000. Shorten init_script and try again.`);
  }
  return combined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalFailure(status: string): boolean {
  return /^(failed|failed_creation|error|deleted)$/i.test(status.trim());
}

export async function waitForSpotSshAndBenchmark(input: {
  id: string;
  auth: SshAuthConfig;
  timeoutMs?: number;
  pollIntervalMs?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  getStatus?: (id: string) => Promise<SpotInstanceStatus>;
  runBenchmark?: (args: { host: string; username: string; port: number; auth: SshAuthConfig; connectTimeoutMs: number; commandTimeoutMs: number }) => Promise<SpotBenchmarkResult>;
  pause?: (ms: number) => Promise<void>;
}): Promise<{ instance: SpotInstanceStatus; benchmark: SpotBenchmarkResult }> {
  const timeoutMs = input.timeoutMs ?? envDuration("EMMA_SPOT_READY_TIMEOUT_MS", 180_000, 10_000, 600_000);
  const pollIntervalMs = input.pollIntervalMs ?? 5_000;
  const connectTimeoutMs = input.connectTimeoutMs ?? envDuration("EMMA_SSH_CONNECT_TIMEOUT_MS", 10_000, 1_000, 30_000);
  const commandTimeoutMs = input.commandTimeoutMs ?? envDuration("EMMA_SSH_COMMAND_TIMEOUT_MS", 90_000, 5_000, 120_000);
  const getStatus = input.getStatus ?? fetchLiveSpotStatus;
  const runBenchmark = input.runBenchmark ?? runSpotSshBenchmark;
  const pause = input.pause ?? sleep;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "not yet reported";
  let lastSshError = "no public IPv4 address yet";

  while (Date.now() < deadline) {
    const instance = await getStatus(input.id);
    lastStatus = instance.status;
    if (isTerminalFailure(instance.status)) {
      throw new Error(`emma reports spot ${input.id} in terminal state ${instance.status}.`);
    }

    const host = instance.publicIpAddresses[0];
    if (instance.sshReady && host && instance.sshUser) {
      try {
        const benchmark = await runBenchmark({
          host,
          username: instance.sshUser,
          port: instance.sshPort,
          auth: input.auth,
          connectTimeoutMs: Math.min(connectTimeoutMs, Math.max(1_000, deadline - Date.now())),
          commandTimeoutMs: Math.min(commandTimeoutMs, Math.max(5_000, deadline - Date.now())),
        });
        return { instance, benchmark };
      } catch (error) {
        lastSshError = error instanceof Error ? error.message : String(error);
        if (isPermanentSshError(error) || /^The SSH benchmark failed:/i.test(lastSshError)) throw error;
      }
    } else {
      lastSshError = host ? `instance state is ${instance.status}` : "no public SSH address yet";
    }
    await pause(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`Timed out waiting ${Math.ceil(timeoutMs / 1000)}s for spot ${input.id} to accept SSH and finish its benchmark (last state: ${lastStatus}; last SSH result: ${lastSshError}).`);
}

export async function provisionLiveSpotAndBenchmark(input: {
  offer: SpotOffer;
  name: string;
  sshKeyId: number;
  pricePerHour: number;
  initScript: string;
  securityGroupId?: number;
  auth: SshAuthConfig;
}): Promise<{
  instance: SpotInstanceStatus;
  benchmark: SpotBenchmarkResult;
  nextAction: string;
  message: string;
}> {
  const raw = await createLiveSpotInstance(input);
  const id = getSpotResourceId(raw);
  if (!id || !/^\d+$/.test(id)) {
    throw new Error("emma accepted the spot create request but returned no usable numeric instance ID. Check the emma project before retrying to avoid creating a duplicate.");
  }

  try {
    const result = await waitForSpotSshAndBenchmark({ id, auth: input.auth });
    return {
      ...result,
      nextAction: `Call instance_status with instance_id=${id} if you want a fresh state/IP check, then call destroy_instance with instance_id=${id} and confirmed=true to stop further spot charges.`,
      message: "Live spot instance provisioned through emma; the SSH benchmark ran on the instance. It is still running and billable until destroy_instance succeeds.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await deleteLiveSpotInstance(id);
      throw new Error(`Spot ${id} was created but the SSH benchmark did not complete. The instance was automatically deleted. Cause: ${reason}`);
    } catch (cleanupError) {
      if (cleanupError instanceof Error && cleanupError.message.startsWith(`Spot ${id} was created but`)) throw cleanupError;
      const cleanupReason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`Spot ${id} was created but the SSH benchmark did not complete. Automatic cleanup also failed: ${cleanupReason}. Immediately call destroy_instance with instance_id=${id} and confirmed=true. Benchmark cause: ${reason}`);
    }
  }
}
