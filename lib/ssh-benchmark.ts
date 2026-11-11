import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Client, type ConnectConfig } from "ssh2";
import type { SpotBenchmarkResult } from "@/lib/types";

export const SPOT_BENCHMARK_COMMAND = [
  "set -eu",
  "if command -v cloud-init >/dev/null 2>&1; then cloud-init status --wait >/dev/null 2>&1; fi",
  "if ! command -v curl >/dev/null 2>&1; then echo 'curl is missing; the cloud-init initScript did not install the benchmark dependency.' >&2; exit 127; fi",
  "echo 'HTTP timing loop: https://example.com (3 requests)'",
  "for i in 1 2 3; do curl --connect-timeout 4 --max-time 10 -sS -o /dev/null -w \"request=$i total_seconds=%{time_total} http_status=%{http_code}\\n\" https://example.com; done",
].join("\n");

export type SshAuthConfig = Pick<ConnectConfig, "privateKey" | "passphrase" | "agent">;

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export async function loadSshAuthConfig(env: Record<string, string | undefined> = process.env): Promise<SshAuthConfig> {
  const inlineKey = env.EMMA_SSH_PRIVATE_KEY?.trim();
  if (inlineKey) {
    return {
      privateKey: inlineKey.replace(/\\n/g, "\n"),
      ...(env.EMMA_SSH_PRIVATE_KEY_PASSPHRASE ? { passphrase: env.EMMA_SSH_PRIVATE_KEY_PASSPHRASE } : {}),
    };
  }

  const keyPath = env.EMMA_SSH_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    const absolutePath = expandHome(keyPath);
    let key: Buffer;
    try {
      const [contents, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
      if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
        throw new Error("Private-key file permissions are too open. Run chmod 600 on the key file.");
      }
      key = contents;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "file access failed";
      throw new Error(`Could not read EMMA_SSH_PRIVATE_KEY_PATH (${detail}).`);
    }
    if (!key.length) throw new Error("The SSH private-key file is empty.");
    return {
      privateKey: key,
      ...(env.EMMA_SSH_PRIVATE_KEY_PASSPHRASE ? { passphrase: env.EMMA_SSH_PRIVATE_KEY_PASSPHRASE } : {}),
    };
  }

  const agent = env.SSH_AUTH_SOCK?.trim();
  if (agent) return { agent };

  throw new Error("Live spot benchmarking needs the private key matching ssh_key_id. Set EMMA_SSH_PRIVATE_KEY_PATH (or EMMA_SSH_PRIVATE_KEY) in the MCP server environment, or provide a loaded SSH agent via SSH_AUTH_SOCK. No spot instance was created.");
}

function appendLimited(current: string, chunk: Buffer | string): string {
  const remaining = 32_000 - current.length;
  if (remaining <= 0) return current;
  return current + String(chunk).slice(0, remaining);
}

export async function runSpotSshBenchmark(input: {
  host: string;
  username: string;
  port?: number;
  auth: SshAuthConfig;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}): Promise<SpotBenchmarkResult> {
  const start = Date.now();
  const connectTimeoutMs = input.connectTimeoutMs ?? 10_000;
  const commandTimeoutMs = input.commandTimeoutMs ?? 90_000;

  return new Promise((resolveResult, rejectResult) => {
    const client = new Client();
    let settled = false;
    let commandStarted = false;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    const timer = setTimeout(() => finish(new Error(`SSH benchmark timed out after ${Math.ceil((Date.now() - start) / 1000)} seconds.`)), connectTimeoutMs + commandTimeoutMs);

    const finish = (error?: Error, result?: SpotBenchmarkResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end();
      if (error) rejectResult(error);
      else if (result) resolveResult(result);
      else rejectResult(new Error("SSH benchmark ended without a result."));
    };

    client.once("ready", () => {
      commandStarted = true;
      client.exec(SPOT_BENCHMARK_COMMAND, { pty: false }, (error, stream) => {
        if (error) {
          finish(error);
          return;
        }
        stream.on("data", (chunk: Buffer | string) => { stdout = appendLimited(stdout, chunk); });
        stream.stderr.on("data", (chunk: Buffer | string) => { stderr = appendLimited(stderr, chunk); });
        stream.once("exit", (code: number | null) => { exitCode = code; });
        stream.once("error", (streamError: Error) => finish(streamError));
        stream.once("close", () => {
          const finalExitCode = exitCode ?? 255;
          const result: SpotBenchmarkResult = {
            command: SPOT_BENCHMARK_COMMAND,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: finalExitCode,
            durationMs: Date.now() - start,
            simulated: false,
          };
          if (finalExitCode !== 0) {
            const detail = result.stderr || `Remote command exited with status ${finalExitCode}.`;
            finish(new Error(`The SSH benchmark failed: ${detail.slice(0, 800)}`));
          } else {
            finish(undefined, result);
          }
        });
      });
    });

    client.once("error", (error) => {
      const prefix = commandStarted ? "SSH session failed" : "SSH connection failed";
      finish(new Error(`${prefix}: ${error.message}`));
    });
    client.once("end", () => {
      if (!settled) finish(new Error("SSH connection ended before the benchmark completed."));
    });
    client.connect({
      host: input.host,
      port: input.port ?? 22,
      username: input.username,
      readyTimeout: connectTimeoutMs,
      keepaliveInterval: 5_000,
      keepaliveCountMax: 3,
      ...input.auth,
    });
  });
}

export function isPermanentSshError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|permission denied|all configured authentication methods failed|invalid private key|bad passphrase/i.test(message);
}
