import { extractIps, getNumber, getString } from "@/lib/emma";

export function normalizeVm(raw: unknown) {
  return {
    id: (getNumber(raw, "id", "vmId", "vm_id") ?? getString(raw, "id", "vmId", "vm_id")) || "unknown",
    name: getString(raw, "name") || "unnamed-vm",
    status: getString(raw, "status") || "unknown",
    provider: getString(raw, "providerName") || getString(raw, "provider") || "",
    location: getString(raw, "locationName") || getString(raw, "location") || "",
    vCpu: getNumber(raw, "vCpu", "v_cpu"),
    ramGb: getNumber(raw, "ramGb", "ram_gb"),
    ipAddresses: extractIps(raw),
  };
}
