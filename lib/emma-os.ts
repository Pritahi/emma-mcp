import { emmaRequest } from "@/lib/emma";

function prop(object: unknown, ...names: string[]): unknown {
  if (typeof object !== "object" || object === null) return undefined;
  const record = object as Record<string, unknown>;
  for (const name of names) {
    if (name in record) return record[name];
    const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) return record[match];
  }
  return undefined;
}

function list(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  const nested = prop(value, "content", "items", "data", "results");
  return Array.isArray(nested) ? nested.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

export interface OsOption { id: number; name: string; type: string; version: string }

export async function fetchOperatingSystems(): Promise<OsOption[]> {
  return list(await emmaRequest("/v1/operating-systems")).flatMap((item) => {
    const id = Number(prop(item, "id", "osId", "os_id"));
    if (!Number.isFinite(id)) return [];
    const name = String(prop(item, "name") ?? "");
    const type = String(prop(item, "type", "osType", "os_type") ?? name);
    const version = String(prop(item, "version", "osVersion", "os_version") ?? "");
    return [{ id, name, type, version }];
  });
}
