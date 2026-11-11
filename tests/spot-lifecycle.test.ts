import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SPOT_OFFERS } from "@/lib/demo-data";
import type { SpotBenchmarkResult, SpotInstanceStatus } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  createLiveSpotInstance: vi.fn(),
  deleteLiveSpotInstance: vi.fn(),
  fetchLiveSpotStatus: vi.fn(),
  getSpotResourceId: vi.fn(),
  runSpotSshBenchmark: vi.fn(),
}));

vi.mock("@/lib/spot-instances", () => ({
  createLiveSpotInstance: mocks.createLiveSpotInstance,
  deleteLiveSpotInstance: mocks.deleteLiveSpotInstance,
  fetchLiveSpotStatus: mocks.fetchLiveSpotStatus,
  getSpotResourceId: mocks.getSpotResourceId,
}));

vi.mock("@/lib/ssh-benchmark", () => ({
  runSpotSshBenchmark: mocks.runSpotSshBenchmark,
  isPermanentSshError: (error: unknown) => /authentication|permission denied|all configured authentication methods failed|invalid private key|bad passphrase/i.test(error instanceof Error ? error.message : String(error)),
}));

import { buildSpotInitScript, provisionLiveSpotAndBenchmark, waitForSpotSshAndBenchmark } from "@/lib/spot-lifecycle";

const sshReadyInstance: SpotInstanceStatus = {
  id: "123",
  name: "spot-test",
  status: "POWERED_ON",
  mode: "live",
  publicIpAddresses: ["198.51.100.10"],
  privateIpAddresses: [],
  ipAddresses: ["198.51.100.10"],
  sshUser: "ubuntu",
  sshPort: 22,
  sshCommand: "ssh ubuntu@198.51.100.10",
  sshReady: true,
};

const benchmark: SpotBenchmarkResult = {
  command: "curl benchmark",
  stdout: "request=1 total_seconds=0.05 http_status=200",
  stderr: "",
  exitCode: 0,
  durationMs: 50,
  simulated: false,
};

describe("spot bootstrap and SSH lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLiveSpotInstance.mockResolvedValue({ id: 123 });
    mocks.deleteLiveSpotInstance.mockResolvedValue(undefined);
    mocks.fetchLiveSpotStatus.mockResolvedValue(sshReadyInstance);
    mocks.getSpotResourceId.mockImplementation((value: { id?: unknown }) => value?.id === undefined ? undefined : String(value.id));
    mocks.runSpotSshBenchmark.mockResolvedValue(benchmark);
  });

  it("prepends a curl bootstrap and enforces emma's 10,000 character init-script limit", () => {
    const script = buildSpotInitScript("#!/bin/bash\necho hello");
    expect(script).toContain("apt-get install -y -qq curl");
    expect(script).toContain("# User-supplied initialization script\necho hello");
    expect(script).not.toMatch(/# User-supplied initialization script\n#!\/bin\/bash/);
    expect(() => buildSpotInitScript("x".repeat(10_000))).toThrow(/10,000/i);
  });

  it("waits for a public SSH address and runs the benchmark on the ready host", async () => {
    const noAddress: SpotInstanceStatus = { ...sshReadyInstance, publicIpAddresses: [], ipAddresses: [], sshReady: false };
    const getStatus = vi.fn().mockResolvedValueOnce(noAddress).mockResolvedValue(sshReadyInstance);
    const runBenchmark = vi.fn().mockResolvedValue(benchmark);
    const result = await waitForSpotSshAndBenchmark({
      id: "123",
      auth: { privateKey: "private-key" },
      timeoutMs: 5_000,
      pollIntervalMs: 0,
      getStatus,
      runBenchmark,
      pause: async () => undefined,
    });
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(runBenchmark).toHaveBeenCalledWith(expect.objectContaining({
      host: "198.51.100.10",
      username: "ubuntu",
      port: 22,
      auth: { privateKey: "private-key" },
    }));
    expect(result).toEqual({ instance: sshReadyInstance, benchmark });
  });

  it("automatically deletes the live spot if SSH benchmarking fails", async () => {
    mocks.runSpotSshBenchmark.mockRejectedValueOnce(new Error("The SSH benchmark failed: curl exited with status 127."));
    const liveOffer = { ...DEMO_SPOT_OFFERS[0], source: "live" as const };
    await expect(provisionLiveSpotAndBenchmark({
      offer: liveOffer,
      name: "spot-test",
      sshKeyId: 44,
      pricePerHour: liveOffer.pricePerHour,
      initScript: "#!/bin/bash\ntrue",
      auth: { privateKey: "private-key" },
    })).rejects.toThrow(/created but the SSH benchmark did not complete.*automatically deleted/i);
    expect(mocks.createLiveSpotInstance).toHaveBeenCalledOnce();
    expect(mocks.deleteLiveSpotInstance).toHaveBeenCalledWith("123");
  });

  it("returns a cleanup instruction and exact ID if automatic deletion also fails", async () => {
    mocks.runSpotSshBenchmark.mockRejectedValueOnce(new Error("The SSH benchmark failed: curl exited with status 127."));
    mocks.deleteLiveSpotInstance.mockRejectedValueOnce(new Error("emma delete returned HTTP 503"));
    const liveOffer = { ...DEMO_SPOT_OFFERS[0], source: "live" as const };
    await expect(provisionLiveSpotAndBenchmark({
      offer: liveOffer,
      name: "spot-test",
      sshKeyId: 44,
      pricePerHour: liveOffer.pricePerHour,
      initScript: "#!/bin/bash\ntrue",
      auth: { privateKey: "private-key" },
    })).rejects.toThrow(/destroy_instance.*instance_id=123.*confirmed=true/i);
    expect(mocks.deleteLiveSpotInstance).toHaveBeenCalledWith("123");
  });

  it("leaves a successfully benchmarked spot running and reports teardown instructions", async () => {
    const liveOffer = { ...DEMO_SPOT_OFFERS[0], source: "live" as const };
    const result = await provisionLiveSpotAndBenchmark({
      offer: liveOffer,
      name: "spot-test",
      sshKeyId: 44,
      pricePerHour: liveOffer.pricePerHour,
      initScript: "#!/bin/bash\ntrue",
      auth: { privateKey: "private-key" },
    });
    expect(result.instance).toEqual(sshReadyInstance);
    expect(result.benchmark).toEqual(benchmark);
    expect(result.nextAction).toContain("destroy_instance");
    expect(mocks.deleteLiveSpotInstance).not.toHaveBeenCalled();
  });

  it("stops immediately when emma reports a terminal failure state", async () => {
    await expect(waitForSpotSshAndBenchmark({
      id: "123",
      auth: { privateKey: "private-key" },
      timeoutMs: 5_000,
      getStatus: async () => ({ ...sshReadyInstance, status: "FAILED" }),
      runBenchmark: vi.fn(),
      pause: async () => undefined,
    })).rejects.toThrow(/terminal state FAILED/i);
  });
});
