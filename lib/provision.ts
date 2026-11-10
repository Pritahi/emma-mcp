import { createVirtualMachine, extractIps, getNumber, getString } from "@/lib/emma";
import { DEMO_SSH_KEYS } from "@/lib/demo-data";
import type { ComputeOffer, ProvisionedVm, SourceMode } from "@/lib/types";

export async function provisionFromPlan(input: {
  offer: ComputeOffer;
  name: string;
  sshKeyId: number | string;
  mode: SourceMode;
  osId?: number;
}): Promise<ProvisionedVm> {
  if (input.mode === "demo") {
    const knownKey = DEMO_SSH_KEYS.some((key) => String(key.id) === String(input.sshKeyId));
    if (!knownKey && !String(input.sshKeyId).startsWith("demo-")) throw new Error("Demo mode only accepts the synthetic showcase SSH key.");
    return {
      id: `demo-${Date.now().toString(36)}`,
      name: input.name,
      status: "demo-ready",
      provider: input.offer.providerName,
      location: input.offer.regionLabel,
      ipAddresses: ["203.0.113.42"],
      sshCommand: "ssh ubuntu@203.0.113.42",
      mode: "demo",
      message: "Preview complete — this is a simulated VM. No cloud resource was created.",
    };
  }

  const raw = await createVirtualMachine({ offer: input.offer, name: input.name, sshKeyId: Number(input.sshKeyId), osId: input.osId });
  const vmName = getString(raw, "name") || input.name;
  const vmId = (getNumber(raw, "id", "vmId", "vm_id") ?? getString(raw, "id", "vmId", "vm_id")) || "created";
  const status = getString(raw, "status") || "provisioning";
  const provider = getString(raw, "providerName") || getString(raw, "provider") || input.offer.providerName;
  const location = getString(raw, "locationName") || getString(raw, "location") || input.offer.regionLabel;
  const ipAddresses = extractIps(raw);
  const osText = `${input.offer.osType ?? ""} ${input.offer.osVersion ?? ""}`.toLowerCase();
  const sshUser = osText.includes("ubuntu") ? "ubuntu" : osText.includes("debian") ? "debian" : "root";
  return {
    id: vmId,
    name: vmName,
    status,
    provider,
    location,
    ipAddresses,
    sshCommand: ipAddresses[0] ? `ssh ${sshUser}@${ipAddresses[0]}` : undefined,
    mode: "live",
    message: "Provision request completed through emma. Check the resource in your emma project if the provider is still finalizing network details.",
  };
}
