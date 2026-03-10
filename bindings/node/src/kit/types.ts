import type { Address } from "@solana/addresses";
import type { Lamports } from "@solana/rpc-types";
import type { ExecutionResult } from "../index.js";

export interface AccountInfo {
  owner: Address;
  lamports: Lamports;
  data: Uint8Array;
  executable: boolean;
}

export interface KeyedAccount {
  address: Address;
  info: AccountInfo;
}

export type KitExecutionResult = ExecutionResult<KeyedAccount>;

export type { ExecutionResult, Clock, EpochSchedule } from "../index.js";
