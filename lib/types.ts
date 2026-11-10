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
