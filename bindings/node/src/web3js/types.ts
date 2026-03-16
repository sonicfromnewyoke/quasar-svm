import { PublicKey } from "@solana/web3.js";
import type { KeyedAccountInfo } from "@solana/web3.js";
import type { ExecutionResult } from "../result.js";

export interface KeyedAccount {
  address: PublicKey;
  lamports: bigint;
  data: Buffer;
  owner: PublicKey;
  executable: boolean;
}

export type Web3ExecutionResult = ExecutionResult<KeyedAccount, PublicKey>;

export function toKeyedAccountInfo(account: KeyedAccount): KeyedAccountInfo {
  return {
    accountId: account.address,
    accountInfo: {
      owner: account.owner,
      lamports: account.lamports,
      data: account.data,
      executable: account.executable,
    },
  };
}

export function fromKeyedAccountInfo(keyed: KeyedAccountInfo): KeyedAccount {
  return {
    address: keyed.accountId,
    lamports: BigInt(keyed.accountInfo.lamports),
    data: Buffer.isBuffer(keyed.accountInfo.data)
      ? keyed.accountInfo.data
      : Buffer.from(keyed.accountInfo.data),
    owner: keyed.accountInfo.owner,
    executable: keyed.accountInfo.executable,
  };
}
