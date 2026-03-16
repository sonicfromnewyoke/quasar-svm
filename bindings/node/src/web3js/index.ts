import { PublicKey } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import type { Address } from "@solana/addresses";
import * as ffi from "../ffi.js";
import {
  serializeInstructions,
  serializeAccounts,
  deserializeResult,
} from "./wire.js";
import { ExecutionResult } from "../result.js";
import { QuasarSvmBase } from "../base.js";
import type { KeyedAccount, Web3ExecutionResult } from "./types.js";
import { uniqueAddress } from "../address.js";
import {
  SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  LOADER_V2,
  LOADER_V3,
  loadElf,
} from "../programs.js";
import {
  packMint, packTokenAccount, rentMinimumBalance,
  MINT_LEN, TOKEN_ACCOUNT_LEN,
} from "../token.js";
import type { TokenAccountState } from "../token.js";

export type { KeyedAccount, Web3ExecutionResult } from "./types.js";
export { toKeyedAccountInfo, fromKeyedAccountInfo } from "./types.js";
export { ExecutionResult } from "../result.js";
export type { ExecutionStatus, ProgramError, AccountDiff, Clock, EpochSchedule } from "../index.js";
export { SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, LOADER_V2, LOADER_V3, LAMPORTS_PER_SOL } from "../programs.js";
export { TokenAccountState } from "../token.js";
import type { Mint as _Mint, Token as _Token } from "../result.js";
export type Mint = _Mint<PublicKey>;
export type Token = _Token<PublicKey>;

// ---------------------------------------------------------------------------
// Opts
// ---------------------------------------------------------------------------

export interface MintOpts {
  mintAuthority?: PublicKey;
  supply?: bigint;
  decimals?: number;
  freezeAuthority?: PublicKey;
}

export interface TokenAccountOpts {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate?: PublicKey;
  state?: TokenAccountState;
  isNative?: bigint;
  delegatedAmount?: bigint;
  closeAuthority?: PublicKey;
}

// ---------------------------------------------------------------------------
// QuasarSvm
// ---------------------------------------------------------------------------

const findAccount = (accounts: KeyedAccount[], address: PublicKey) =>
  accounts.find(a => a.address.equals(address));

const decodeAddress = (bytes: Uint8Array) => new PublicKey(bytes);

export class QuasarSvm extends QuasarSvmBase {
  addProgram(programId: PublicKey, elf: Uint8Array, loaderVersion = LOADER_V3): this {
    this.check(
      ffi.quasar_svm_add_program(
        this.ptr,
        programId.toBuffer(),
        Buffer.from(elf),
        elf.length,
        loaderVersion
      )
    );
    return this;
  }

  addTokenProgram(): this {
    return this.addProgram(new PublicKey(SPL_TOKEN_PROGRAM_ID), loadElf("spl_token.so"), LOADER_V2);
  }

  addToken2022Program(): this {
    return this.addProgram(new PublicKey(SPL_TOKEN_2022_PROGRAM_ID), loadElf("spl_token_2022.so"), LOADER_V3);
  }

  addAssociatedTokenProgram(): this {
    return this.addProgram(new PublicKey(SPL_ASSOCIATED_TOKEN_PROGRAM_ID), loadElf("spl_associated_token.so"), LOADER_V2);
  }

  // ---------- Account store ----------

  setAccount(account: KeyedAccount): void {
    const dataBuf = account.data.length > 0 ? Buffer.from(account.data) : null;
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        account.address.toBuffer(),
        account.owner.toBuffer(),
        BigInt(account.lamports),
        dataBuf,
        account.data.length,
        account.executable
      )
    );
  }

  getAccount(pubkey: PublicKey): KeyedAccount | null {
    const ptrOut = [null as unknown];
    const lenOut = [BigInt(0)];
    const code = ffi.quasar_svm_get_account(this.ptr, pubkey.toBuffer(), ptrOut, lenOut);
    if (code !== 0) return null;

    const resultPtr = ptrOut[0];
    const resultLen = Number(lenOut[0]);
    const buf = Buffer.from(ffi.koffi.decode(resultPtr, "uint8_t", resultLen));
    ffi.quasar_result_free(resultPtr, resultLen);

    let o = 0;
    const address = new PublicKey(buf.subarray(o, o + 32));
    o += 32;
    const owner = new PublicKey(buf.subarray(o, o + 32));
    o += 32;
    const lamports = buf.readBigUInt64LE(o);
    o += 8;
    const dLen = buf.readUInt32LE(o);
    o += 4;
    const data = Buffer.from(buf.subarray(o, o + dLen));
    o += dLen;
    const executable = buf[o] !== 0;

    return { address, lamports, data, owner, executable };
  }

  airdrop(pubkey: PublicKey, lamports: bigint): void {
    this.check(ffi.quasar_svm_airdrop(this.ptr, pubkey.toBuffer(), lamports));
  }

  createAccount(pubkey: PublicKey, space: bigint, owner: PublicKey): void {
    this.check(
      ffi.quasar_svm_create_account(this.ptr, pubkey.toBuffer(), space, owner.toBuffer())
    );
  }

  // ---------- Cheatcodes ----------

  setTokenBalance(address: PublicKey, amount: bigint): void {
    this.check(ffi.quasar_svm_set_token_balance(this.ptr, address.toBuffer(), amount));
  }

  setMintSupply(address: PublicKey, supply: bigint): void {
    this.check(ffi.quasar_svm_set_mint_supply(this.ptr, address.toBuffer(), supply));
  }

  // ---------- Execution ----------

  processInstruction(instruction: TransactionInstruction, accounts: KeyedAccount[]): Web3ExecutionResult {
    return this.exec(ffi.quasar_svm_process_transaction, serializeInstructions([instruction]), serializeAccounts(accounts));
  }

  processInstructionChain(instructions: TransactionInstruction[], accounts: KeyedAccount[]): Web3ExecutionResult {
    return this.exec(ffi.quasar_svm_process_transaction, serializeInstructions(instructions), serializeAccounts(accounts));
  }

  simulateInstruction(instruction: TransactionInstruction, accounts: KeyedAccount[]): Web3ExecutionResult {
    return this.exec(ffi.quasar_svm_simulate_transaction, serializeInstructions([instruction]), serializeAccounts(accounts));
  }

  simulateInstructionChain(instructions: TransactionInstruction[], accounts: KeyedAccount[]): Web3ExecutionResult {
    return this.exec(ffi.quasar_svm_simulate_transaction, serializeInstructions(instructions), serializeAccounts(accounts));
  }

  // ---------- Internal ----------

  private exec(fn: Function, ixBuf: Buffer, acctBuf: Buffer): Web3ExecutionResult {
    const raw = deserializeResult(this.execRaw(fn, ixBuf, acctBuf));
    return new ExecutionResult(raw, findAccount, decodeAddress);
  }
}

// ---------------------------------------------------------------------------
// Account factories
// ---------------------------------------------------------------------------

/** Create a system-owned account with the given lamports. Address auto-generated if omitted. */
export function createSystemAccount(lamports: bigint): KeyedAccount;
export function createSystemAccount(address: PublicKey, lamports: bigint): KeyedAccount;
export function createSystemAccount(addressOrLamports: PublicKey | bigint, lamports?: bigint): KeyedAccount {
  let addr: PublicKey;
  let lamps: bigint;
  if (addressOrLamports instanceof PublicKey) {
    addr = addressOrLamports;
    lamps = lamports!;
  } else {
    addr = new PublicKey(uniqueAddress());
    lamps = addressOrLamports;
  }
  return {
    address: addr,
    owner: new PublicKey(SYSTEM_PROGRAM_ID),
    lamports: lamps,
    data: Buffer.alloc(0),
    executable: false,
  };
}

/** Create a pre-initialized mint account. Address auto-generated if omitted. */
export function createMintAccount(opts?: MintOpts, tokenProgramId?: PublicKey): KeyedAccount;
export function createMintAccount(address: PublicKey, opts?: MintOpts, tokenProgramId?: PublicKey): KeyedAccount;
export function createMintAccount(
  first?: PublicKey | MintOpts,
  second?: MintOpts | PublicKey,
  third?: PublicKey,
): KeyedAccount {
  let addr: PublicKey;
  let opts: MintOpts;
  let programId: PublicKey;

  if (first instanceof PublicKey) {
    addr = first;
    opts = (second && !(second instanceof PublicKey)) ? second : {};
    programId = third ?? (second instanceof PublicKey ? second : undefined) ?? new PublicKey(SPL_TOKEN_PROGRAM_ID);
  } else {
    addr = new PublicKey(uniqueAddress());
    opts = first ?? {};
    programId = second instanceof PublicKey ? second : new PublicKey(SPL_TOKEN_PROGRAM_ID);
  }

  const data = Buffer.from(packMint({
    mintAuthority: opts.mintAuthority ? opts.mintAuthority.toBase58() as Address : null,
    supply: opts.supply ?? 0n,
    decimals: opts.decimals ?? 9,
    isInitialized: true,
    freezeAuthority: opts.freezeAuthority ? opts.freezeAuthority.toBase58() as Address : null,
  }));
  return {
    address: addr,
    owner: programId,
    lamports: rentMinimumBalance(MINT_LEN),
    data,
    executable: false,
  };
}

/** Create a pre-initialized token account. Address auto-generated if omitted. */
export function createTokenAccount(opts: TokenAccountOpts, tokenProgramId?: PublicKey): KeyedAccount;
export function createTokenAccount(address: PublicKey, opts: TokenAccountOpts, tokenProgramId?: PublicKey): KeyedAccount;
export function createTokenAccount(
  first: PublicKey | TokenAccountOpts,
  second?: TokenAccountOpts | PublicKey,
  third?: PublicKey,
): KeyedAccount {
  let addr: PublicKey;
  let opts: TokenAccountOpts;
  let programId: PublicKey;

  if (first instanceof PublicKey) {
    addr = first;
    opts = second as TokenAccountOpts;
    programId = third ?? new PublicKey(SPL_TOKEN_PROGRAM_ID);
  } else {
    addr = new PublicKey(uniqueAddress());
    opts = first;
    programId = second instanceof PublicKey ? second : new PublicKey(SPL_TOKEN_PROGRAM_ID);
  }

  const data = Buffer.from(packTokenAccount({
    mint: opts.mint.toBase58() as Address,
    owner: opts.owner.toBase58() as Address,
    amount: opts.amount,
    delegate: opts.delegate ? opts.delegate.toBase58() as Address : null,
    state: (opts.state ?? 1) as number,
    isNative: opts.isNative ?? null,
    delegatedAmount: opts.delegatedAmount ?? 0n,
    closeAuthority: opts.closeAuthority ? opts.closeAuthority.toBase58() as Address : null,
  }));
  return {
    address: addr,
    owner: programId,
    lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
    data,
    executable: false,
  };
}

/** Create a pre-initialized associated token account. Derives the ATA address automatically. */
export function createAssociatedTokenAccount(
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
  tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): KeyedAccount {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    new PublicKey(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  const data = Buffer.from(packTokenAccount({
    mint: mint.toBase58() as Address,
    owner: owner.toBase58() as Address,
    amount,
    delegate: null,
    state: 1,
    isNative: null,
    delegatedAmount: 0n,
    closeAuthority: null,
  }));
  return {
    address: ata,
    owner: tokenProgramId,
    lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
    data,
    executable: false,
  };
}

