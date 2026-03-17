import type { ExecutionStatus } from "../index.js";

export interface InternalAccount {
  address: Uint8Array;
  owner: Uint8Array;
  lamports: bigint;
  data: Uint8Array;
  executable: boolean;
}

export interface InternalResult {
  status: ExecutionStatus;
  computeUnits: bigint;
  executionTimeUs: bigint;
  returnData: Uint8Array;
  accounts: InternalAccount[];
  logs: string[];
}
