import type { Address } from "@solana/addresses";
import { address, getAddressEncoder, getAddressDecoder, getProgramDerivedAddress } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import * as ffi from "../ffi.js";
import {
  serializeInstructions,
  serializeAccounts,
  deserializeResult,
} from "./wire.js";
import { ExecutionResult } from "../result.js";
import { QuasarSvmBase } from "../base.js";
import type { Account, KitExecutionResult } from "./types.js";
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

export type { Account, KitExecutionResult } from "./types.js";
export { ExecutionResult } from "../result.js";
export type { ExecutionStatus, ProgramError, AccountDiff, Clock, EpochSchedule } from "../index.js";
export { SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, LOADER_V2, LOADER_V3, LAMPORTS_PER_SOL } from "../programs.js";
export { TokenAccountState } from "../token.js";
import type { Mint as _Mint, Token as _Token } from "../result.js";
export type Mint = _Mint<Address>;
export type Token = _Token<Address>;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// ---------------------------------------------------------------------------
// Opts
// ---------------------------------------------------------------------------

export interface MintOpts {
  mintAuthority?: Address;
  supply?: bigint;
  decimals?: number;
  freezeAuthority?: Address;
}

export interface TokenAccountOpts {
  mint: Address;
  owner: Address;
  amount: bigint;
  delegate?: Address;
  state?: TokenAccountState;
  isNative?: bigint;
  delegatedAmount?: bigint;
  closeAuthority?: Address;
}

// ---------------------------------------------------------------------------
// QuasarSvm
// ---------------------------------------------------------------------------

const findAccount = (accounts: Account[], addr: Address) =>
  accounts.find(a => a.address === addr);

const decodeAddress = (bytes: Uint8Array) => addressDecoder.decode(bytes) as Address;

export class QuasarSvm extends QuasarSvmBase {
  addProgram(programId: Address, elf: Uint8Array, loaderVersion = LOADER_V3): this {
    this.check(
      ffi.quasar_svm_add_program(
        this.ptr,
        Buffer.from(addressEncoder.encode(programId)),
        Buffer.from(elf),
        elf.length,
        loaderVersion
      )
    );
    return this;
  }

  addTokenProgram(): this {
    return this.addProgram(address(SPL_TOKEN_PROGRAM_ID), loadElf("spl_token.so"), LOADER_V2);
  }

  addToken2022Program(): this {
    return this.addProgram(address(SPL_TOKEN_2022_PROGRAM_ID), loadElf("spl_token_2022.so"), LOADER_V3);
  }

  addAssociatedTokenProgram(): this {
    return this.addProgram(address(SPL_ASSOCIATED_TOKEN_PROGRAM_ID), loadElf("spl_associated_token.so"), LOADER_V2);
  }

  // ---------- Account store ----------

  setAccount(account: Account): void {
    const dataBuf = account.data.length > 0 ? Buffer.from(account.data) : null;
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        Buffer.from(addressEncoder.encode(account.address)),
        Buffer.from(addressEncoder.encode(account.owner)),
        BigInt(account.lamports),
        dataBuf,
        account.data.length,
        account.executable
      )
    );
  }

  getAccount(pubkey: Address): Account | null {
    const ptrOut = [null as unknown];
    const lenOut = [BigInt(0)];
    const code = ffi.quasar_svm_get_account(
      this.ptr,
      Buffer.from(addressEncoder.encode(pubkey)),
      ptrOut,
      lenOut
    );
    if (code !== 0) return null;

    const resultPtr = ptrOut[0];
    const resultLen = Number(lenOut[0]);
    const buf = Buffer.from(ffi.koffi.decode(resultPtr, "uint8_t", resultLen));
    ffi.quasar_result_free(resultPtr, resultLen);

    let o = 0;
    const acctAddress = addressDecoder.decode(buf.subarray(o, o + 32));
    o += 32;
    const owner = addressDecoder.decode(buf.subarray(o, o + 32));
    o += 32;
    const lamports = buf.readBigUInt64LE(o);
    o += 8;
    const dLen = buf.readUInt32LE(o);
    o += 4;
    const data = new Uint8Array(buf.subarray(o, o + dLen));
    o += dLen;
    const executable = buf[o] !== 0;

    return {
      address: acctAddress as Address,
      lamports,
      data,
      owner: owner as Address,
      executable,
    };
  }

  airdrop(pubkey: Address, amount: bigint): void {
    this.check(
      ffi.quasar_svm_airdrop(
        this.ptr,
        Buffer.from(addressEncoder.encode(pubkey)),
        amount
      )
    );
  }

  createAccount(pubkey: Address, space: bigint, owner: Address): void {
    this.check(
      ffi.quasar_svm_create_account(
        this.ptr,
        Buffer.from(addressEncoder.encode(pubkey)),
        space,
        Buffer.from(addressEncoder.encode(owner))
      )
    );
  }

  // ---------- Cheatcodes ----------

  setTokenBalance(addr: Address, amount: bigint): void {
    this.check(
      ffi.quasar_svm_set_token_balance(
        this.ptr,
        Buffer.from(addressEncoder.encode(addr)),
        amount
      )
    );
  }

  setMintSupply(addr: Address, supply: bigint): void {
    this.check(
      ffi.quasar_svm_set_mint_supply(
        this.ptr,
        Buffer.from(addressEncoder.encode(addr)),
        supply
      )
    );
  }

  // ---------- Execution ----------

  processInstruction(instruction: Instruction, accounts: Account[]): KitExecutionResult {
    return this.exec(ffi.quasar_svm_process_transaction, serializeInstructions([instruction]), serializeAccounts(accounts));
  }

  processInstructionChain(instructions: Instruction[], accounts: Account[]): KitExecutionResult {
    return this.exec(ffi.quasar_svm_process_transaction, serializeInstructions(instructions), serializeAccounts(accounts));
  }

  simulateInstruction(instruction: Instruction, accounts: Account[]): KitExecutionResult {
    return this.exec(ffi.quasar_svm_simulate_transaction, serializeInstructions([instruction]), serializeAccounts(accounts));
  }

  simulateInstructionChain(instructions: Instruction[], accounts: Account[]): KitExecutionResult {
    return this.exec(ffi.quasar_svm_simulate_transaction, serializeInstructions(instructions), serializeAccounts(accounts));
  }

  // ---------- Internal ----------

  private exec(fn: Function, ixBuf: Buffer, acctBuf: Buffer): KitExecutionResult {
    const raw = deserializeResult(this.execRaw(fn, ixBuf, acctBuf));
    return new ExecutionResult(raw, findAccount, decodeAddress);
  }
}

// ---------------------------------------------------------------------------
// Account factories
// ---------------------------------------------------------------------------

const enc = (a: Address) => new Uint8Array(addressEncoder.encode(a));

/** Create a system-owned account with the given lamports. Address auto-generated if omitted. */
export function createSystemAccount(lamports: bigint): Account;
export function createSystemAccount(addr: Address, lamports: bigint): Account;
export function createSystemAccount(addrOrLamports: Address | bigint, lamports?: bigint): Account {
  let addr: Address;
  let lamps: bigint;
  if (typeof addrOrLamports === "bigint") {
    addr = addressDecoder.decode(uniqueAddress()) as Address;
    lamps = addrOrLamports;
  } else {
    addr = addrOrLamports;
    lamps = lamports!;
  }
  return {
    address: addr,
    owner: address(SYSTEM_PROGRAM_ID),
    lamports: lamps,
    data: new Uint8Array(0),
    executable: false,
  };
}

/** Create a pre-initialized mint account. Address auto-generated if omitted. */
export function createMintAccount(opts?: MintOpts, tokenProgramId?: Address): Account;
export function createMintAccount(addr: Address, opts?: MintOpts, tokenProgramId?: Address): Account;
export function createMintAccount(
  first?: Address | MintOpts,
  second?: MintOpts | Address,
  third?: Address,
): Account {
  let addr: Address;
  let opts: MintOpts;
  let programId: Address;

  if (typeof first === "string") {
    addr = first;
    opts = (second && typeof second !== "string") ? second : {};
    programId = third ?? (typeof second === "string" ? second : undefined) ?? address(SPL_TOKEN_PROGRAM_ID);
  } else {
    addr = addressDecoder.decode(uniqueAddress()) as Address;
    opts = first ?? {};
    programId = typeof second === "string" ? second : address(SPL_TOKEN_PROGRAM_ID);
  }

  const data = packMint({
    mintAuthority: opts.mintAuthority ?? null,
    supply: opts.supply ?? 0n,
    decimals: opts.decimals ?? 9,
    isInitialized: true,
    freezeAuthority: opts.freezeAuthority ?? null,
  });
  return {
    address: addr,
    owner: programId,
    lamports: rentMinimumBalance(MINT_LEN),
    data,
    executable: false,
  };
}

/** Create a pre-initialized token account. Address auto-generated if omitted. */
export function createTokenAccount(opts: TokenAccountOpts, tokenProgramId?: Address): Account;
export function createTokenAccount(addr: Address, opts: TokenAccountOpts, tokenProgramId?: Address): Account;
export function createTokenAccount(
  first: Address | TokenAccountOpts,
  second?: TokenAccountOpts | Address,
  third?: Address,
): Account {
  let addr: Address;
  let opts: TokenAccountOpts;
  let programId: Address;

  if (typeof first === "string") {
    addr = first;
    opts = second as TokenAccountOpts;
    programId = third ?? address(SPL_TOKEN_PROGRAM_ID);
  } else {
    addr = addressDecoder.decode(uniqueAddress()) as Address;
    opts = first;
    programId = typeof second === "string" ? second : address(SPL_TOKEN_PROGRAM_ID);
  }

  const data = packTokenAccount({
    mint: opts.mint,
    owner: opts.owner,
    amount: opts.amount,
    delegate: opts.delegate ?? null,
    state: (opts.state ?? 1) as number,
    isNative: opts.isNative ?? null,
    delegatedAmount: opts.delegatedAmount ?? 0n,
    closeAuthority: opts.closeAuthority ?? null,
  });
  return {
    address: addr,
    owner: programId,
    lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
    data,
    executable: false,
  };
}

/** Create a pre-initialized associated token account. Derives the ATA address automatically. */
export async function createAssociatedTokenAccount(
  owner: Address,
  mint: Address,
  amount: bigint,
  tokenProgramId: Address = address(SPL_TOKEN_PROGRAM_ID),
): Promise<Account> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
    seeds: [enc(owner), enc(tokenProgramId), enc(mint)],
  });
  const data = packTokenAccount({
    mint,
    owner,
    amount,
    delegate: null,
    state: 1,
    isNative: null,
    delegatedAmount: 0n,
    closeAuthority: null,
  });
  return {
    address: ata,
    owner: tokenProgramId,
    lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
    data,
    executable: false,
  };
}

