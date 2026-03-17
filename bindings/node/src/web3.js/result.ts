import { Address } from "@solana/web3.js";
import type { KeyedAccountInfo } from "@solana/web3.js";
import type { Decoder } from "@solana/codecs-core";
import { ExecutionResultBase } from "../internal/result.js";
import type { InternalResult } from "../internal/types.js";

export class ExecutionResult extends ExecutionResultBase {
  readonly accounts: KeyedAccountInfo[];

  constructor(data: InternalResult) {
    super(data);
    this.accounts = data.accounts.map(a => ({
      accountId: new Address(a.address),
      accountInfo: {
        owner: new Address(a.owner),
        lamports: a.lamports,
        data: Buffer.from(a.data),
        executable: a.executable,
      },
    }));
  }

  account(address: Address): KeyedAccountInfo | null;
  account<T>(address: Address, decoder: Decoder<T>): T | null;
  account<T>(address: Address, decoder?: Decoder<T>): KeyedAccountInfo | T | null {
    const acct = this.accounts.find(a => a.accountId === address) ?? null;
    if (acct && decoder) {
      return decoder.decode(acct.accountInfo.data);
    }
    return acct;
  }
}
