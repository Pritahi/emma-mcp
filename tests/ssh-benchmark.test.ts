import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSshAuthConfig, SPOT_BENCHMARK_COMMAND } from "@/lib/ssh-benchmark";

describe("SSH benchmark configuration", () => {
  it("requires a key or loaded SSH agent before any live spot is created", async () => {
    await expect(loadSshAuthConfig({})).rejects.toThrow(/No spot instance was created/i);
  });

  it("loads an inline private key and optional passphrase", async () => {
    const auth = await loadSshAuthConfig({
      EMMA_SSH_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey-data\\n-----END PRIVATE KEY-----",
      EMMA_SSH_PRIVATE_KEY_PASSPHRASE: "test-passphrase",
    });
    expect(String(auth.privateKey)).toBe("-----BEGIN PRIVATE KEY-----\nkey-data\n-----END PRIVATE KEY-----");
    expect(auth.passphrase).toBe("test-passphrase");
  });

  it("reads a private-key file only with restrictive permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "emma-ssh-test-"));
    const path = join(dir, "id_ed25519");
    try {
      await writeFile(path, "test-private-key", { mode: 0o600 });
      const auth = await loadSshAuthConfig({ EMMA_SSH_PRIVATE_KEY_PATH: path });
      expect(Buffer.from(auth.privateKey as Buffer).toString("utf8")).toBe("test-private-key");

      if (process.platform !== "win32") {
        await chmod(path, 0o644);
        await expect(loadSshAuthConfig({ EMMA_SSH_PRIVATE_KEY_PATH: path })).rejects.toThrow(/permissions are too open/i);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports a loaded SSH agent and runs three timed HTTPS requests", async () => {
    const auth = await loadSshAuthConfig({ SSH_AUTH_SOCK: "/tmp/test-agent.sock" });
    expect(auth.agent).toBe("/tmp/test-agent.sock");
    expect(SPOT_BENCHMARK_COMMAND).toContain("cloud-init status --wait");
    expect(SPOT_BENCHMARK_COMMAND.match(/curl --connect-timeout/g)).toHaveLength(1);
    expect(SPOT_BENCHMARK_COMMAND).toContain("for i in 1 2 3");
    expect(SPOT_BENCHMARK_COMMAND).toContain("https://example.com");
  });
});
