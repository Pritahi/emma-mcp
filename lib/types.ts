export type SourceMode = "live" | "demo";

export interface ComputeIntent {
  prompt: string;
  name: string;
  minVcpu: number;
  minRamGb: number;
  minVolumeGb: number;
  osQuery: string;
  regionQuery?: string;
  continentQuery?: string;
  maxPricePerHour?: number;
  currency: string;
}

export interface OfferCost {
  amount: number;
  currency: string;
  unit: string;
  perHour?: number;
}

export interface ComputeOffer {
  id: string;
  providerId?: number;
  providerName: string;
  locationId?: number;
  locationName: string;
  continent?: string;
  region?: string;
  dataCenterId: string;
  dataCenterName: string;
  osId?: number;
  osType?: string;
  osVersion?: string;
  vCpu: number;
  vCpuType: string;
  ramGb: number;
  volumeGb: number;
  volumeType: string;
  cloudNetworkTypes: string[];
  cost?: OfferCost;
  regionLabel: string;
  source: SourceMode;
}

export interface SignedPlan {
  version: 1;
  mode: SourceMode;
  expiresAt: number;
  intent: ComputeIntent;
  offer: ComputeOffer;
}

export interface PlannedOffer extends ComputeOffer {
  planToken: string;
  hourlyLabel: string;
  monthlyLabel: string;
}

export interface SshKeySummary {
  id: number | string;
  name: string;
  fingerprint?: string;
  keyType?: string;
  source: SourceMode;
}

export interface ProvisionedVm {
  id: number | string;
  name: string;
  status: string;
  provider?: string;
  location?: string;
  ipAddresses: string[];
  sshCommand?: string;
  mode: SourceMode;
  message: string;
}

export interface SpotOffer {
  id: string;
  providerId?: number;
  providerName: string;
  locationId?: number;
  locationName: string;
  country?: string;
  continent?: string;
  region?: string;
  dataCenterId: string;
  dataCenterName: string;
  osId: number;
  osType?: string;
  osVersion?: string;
  cloudNetworkTypes: string[];
  vCpuType: string;
  vCpu: number;
  ramGb: number;
  volumeGb: number;
  volumeType: string;
  acceleratorTypeId?: string;
  gpuType?: string;
  gpuCount: number;
  gpuMemoryGb?: number;
  cost: OfferCost;
  pricePerHour: number;
  currency: string;
  regionLabel: string;
  source: SourceMode;
}

export interface SpotSearchFilters {
  minVcpu?: number;
  minRamGb?: number;
  minGpuCount?: number;
  gpuType?: string;
  region?: string;
  maxPricePerHour?: number;
  currency?: string;
  limit?: number;
}

export interface SpotInstanceStatus {
  id: string;
  name: string;
  status: string;
  mode: SourceMode;
  provider?: string;
  location?: string;
  os?: string;
  vCpu?: number;
  ramGb?: number;
  gpuType?: string;
  gpuCount?: number;
  publicIpAddresses: string[];
  privateIpAddresses: string[];
  ipAddresses: string[];
  sshUser?: string;
  sshPort: number;
  sshCommand?: string;
  sshReady: boolean;
}

export interface SpotBenchmarkResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  simulated: boolean;
}
