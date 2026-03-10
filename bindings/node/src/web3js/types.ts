import type { KeyedAccountInfo } from "@solana/web3.js";
import type { ExecutionResult } from "../index.js";

export type Web3ExecutionResult = ExecutionResult<KeyedAccountInfo>;

export type { ExecutionResult, Clock, EpochSchedule } from "../index.js";
