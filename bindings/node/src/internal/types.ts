import type { ExecutionStatus } from "../index.js";

export interface InternalAccount {
  address: Uint8Array;
  owner: Uint8Array;
  lamports: bigint;
  data: Uint8Array;
  executable: boolean;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner: string | null;
  uiTokenAmount: {
    uiAmount: number | null;
    decimals: number;
    amount: string;
  };
}

export interface InnerInstructions {
  index: number;
  instructions: Array<{
    programIdIndex: number;
    accounts: number[];
    data: Uint8Array;
  }>;
}

export interface ExecutedInstruction {
  nestingLevel: number;
  programId: Uint8Array;
  succeeded: boolean;
}

export interface ExecutionTrace {
  instructions: ExecutedInstruction[];
}

export interface InternalResult {
  status: ExecutionStatus;
  computeUnits: bigint;
  executionTimeUs: bigint;
  returnData: Uint8Array;
  accounts: InternalAccount[];
  logs: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  innerInstructions: InnerInstructions[];
  executionTrace: ExecutionTrace;
}
