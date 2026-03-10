export interface ExecutionResult<TAccount> {
  status: number;
  computeUnits: bigint;
  executionTimeUs: bigint;
  returnData: Uint8Array;
  accounts: TAccount[];
  logs: string[];
  errorMessage: string | null;
}

export interface Clock {
  slot: bigint;
  epochStartTimestamp: bigint;
  epoch: bigint;
  leaderScheduleEpoch: bigint;
  unixTimestamp: bigint;
}

export interface EpochSchedule {
  slotsPerEpoch: bigint;
  leaderScheduleSlotOffset: bigint;
  warmup: boolean;
  firstNormalEpoch: bigint;
  firstNormalSlot: bigint;
}
