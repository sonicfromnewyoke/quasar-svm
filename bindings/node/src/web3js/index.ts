import { Keypair, PublicKey } from "@solana/web3.js";
import type { TransactionInstruction, KeyedAccountInfo, AccountInfo } from "@solana/web3.js";
import * as ffi from "../ffi.js";
import {
  serializeInstructions,
  serializeAccounts,
  deserializeResult,
} from "./wire.js";
import type { ExecutionResult } from "../index.js";
import type { Clock, EpochSchedule } from "../index.js";
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
  unpackMint, unpackTokenAccount,
  tokenTransferData, tokenMintToData, tokenBurnData,
  MINT_LEN, TOKEN_ACCOUNT_LEN,
} from "../token.js";
import type { TokenAccountState, MintData, TokenAccountData } from "../token.js";
import type { ProgramError, ExecutionStatus } from "../index.js";

export type { Web3ExecutionResult } from "./types.js";
export type { ExecutionResult, ExecutionStatus, ProgramError, Clock, EpochSchedule } from "../index.js";
export { SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, LOADER_V2, LOADER_V3 } from "../programs.js";
export { TokenAccountState } from "../token.js";
export type { MintData, TokenAccountData } from "../token.js";

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

export class QuasarSvm {
  private ptr: unknown;
  private freed = false;

  constructor() {
    this.ptr = ffi.quasar_svm_new();
    if (!this.ptr) {
      throw new Error(
        `Failed to create QuasarSvm: ${ffi.quasar_last_error() ?? "unknown"}`
      );
    }
  }

  free(): void {
    if (!this.freed) {
      ffi.quasar_svm_free(this.ptr);
      this.freed = true;
    }
  }

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

  addSystemProgram(): this {
    return this;
  }

  /** Store an account in the SVM's persistent account database. */
  setAccount(pubkey: PublicKey, account: AccountInfo<Buffer>): void {
    const dataBuf = account.data.length > 0 ? Buffer.from(account.data) : null;
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        pubkey.toBuffer(),
        account.owner.toBuffer(),
        BigInt(account.lamports),
        dataBuf,
        account.data.length,
        account.executable
      )
    );
  }

  /** Read an account from the SVM's persistent account database. */
  getAccount(pubkey: PublicKey): KeyedAccountInfo | null {
    const ptrOut = [null as unknown];
    const lenOut = [BigInt(0)];
    const code = ffi.quasar_svm_get_account(this.ptr, pubkey.toBuffer(), ptrOut, lenOut);
    if (code !== 0) return null;

    const resultPtr = ptrOut[0];
    const resultLen = Number(lenOut[0]);
    const buf = Buffer.from(ffi.koffi.decode(resultPtr, "uint8_t", resultLen));
    ffi.quasar_result_free(resultPtr, resultLen);

    // Deserialize: [32] pubkey [32] owner [8] lamports [4] data_len [N] data [1] executable
    let o = 0;
    const accountId = new PublicKey(buf.subarray(o, o + 32));
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

    return { accountId, accountInfo: { owner, lamports, data, executable } };
  }

  /** Give lamports to an account, creating it if it doesn't exist. */
  airdrop(pubkey: PublicKey, lamports: bigint): void {
    this.check(ffi.quasar_svm_airdrop(this.ptr, pubkey.toBuffer(), lamports));
  }

  /** Create a rent-exempt account with the given space and owner. */
  createAccount(pubkey: PublicKey, space: bigint, owner: PublicKey): void {
    this.check(
      ffi.quasar_svm_create_account(this.ptr, pubkey.toBuffer(), space, owner.toBuffer())
    );
  }

  /** Execute a transaction without committing any state changes. */
  simulateTransaction(
    instructions: TransactionInstruction[],
    accounts: KeyedAccountInfo[] | Record<string, KeyedAccountInfo>
  ): ExecutionResult<KeyedAccountInfo> {
    return this.exec(
      ffi.quasar_svm_simulate_transaction,
      serializeInstructions(instructions),
      serializeAccounts(flattenAccounts(accounts))
    );
  }

  /** Save a snapshot of the current account state. */
  snapshot(): unknown {
    const handle = ffi.quasar_svm_snapshot(this.ptr);
    if (!handle) throw new Error("Failed to create snapshot");
    return handle;
  }

  /** Restore account state from a previous snapshot. */
  restore(snap: unknown): void {
    this.check(ffi.quasar_svm_restore(this.ptr, snap));
  }

  /** Free a snapshot without restoring it. */
  snapshotFree(snap: unknown): void {
    ffi.quasar_svm_snapshot_free(snap);
  }

  setClock(opts: Clock): void {
    this.check(
      ffi.quasar_svm_set_clock(
        this.ptr,
        opts.slot,
        opts.epochStartTimestamp,
        opts.epoch,
        opts.leaderScheduleEpoch,
        opts.unixTimestamp
      )
    );
  }

  warpToSlot(slot: bigint): void {
    this.check(ffi.quasar_svm_warp_to_slot(this.ptr, slot));
  }

  setRent(lamportsPerByte: bigint): void {
    this.check(
      ffi.quasar_svm_set_rent(
        this.ptr,
        lamportsPerByte,
        1.0,
        0
      )
    );
  }

  setEpochSchedule(opts: EpochSchedule): void {
    this.check(
      ffi.quasar_svm_set_epoch_schedule(
        this.ptr,
        opts.slotsPerEpoch,
        opts.leaderScheduleSlotOffset,
        opts.warmup,
        opts.firstNormalEpoch,
        opts.firstNormalSlot
      )
    );
  }

  setComputeBudget(maxUnits: bigint): void {
    this.check(ffi.quasar_svm_set_compute_budget(this.ptr, maxUnits));
  }

  processInstruction(
    instructions: TransactionInstruction | TransactionInstruction[],
    accounts: KeyedAccountInfo[] | Record<string, KeyedAccountInfo>
  ): ExecutionResult<KeyedAccountInfo> {
    const ixs = Array.isArray(instructions) ? instructions : [instructions];
    return this.exec(
      ffi.quasar_svm_process_instructions,
      serializeInstructions(ixs),
      serializeAccounts(flattenAccounts(accounts))
    );
  }

  processTransaction(
    instructions: TransactionInstruction[],
    accounts: KeyedAccountInfo[] | Record<string, KeyedAccountInfo>
  ): ExecutionResult<KeyedAccountInfo> {
    return this.exec(
      ffi.quasar_svm_process_transaction,
      serializeInstructions(instructions),
      serializeAccounts(flattenAccounts(accounts))
    );
  }

  // ---------- internal ----------

  private check(code: number): void {
    if (code !== 0) {
      throw new Error(
        `QuasarSvm error (${code}): ${ffi.quasar_last_error() ?? "unknown"}`
      );
    }
  }

  private exec(
    fn: Function,
    ixBuf: Buffer,
    acctBuf: Buffer
  ): ExecutionResult<KeyedAccountInfo> {
    const ptrOut = [null as unknown];
    const lenOut = [BigInt(0)];

    const code = fn(
      this.ptr,
      ixBuf,
      ixBuf.length,
      acctBuf,
      acctBuf.length,
      ptrOut,
      lenOut
    );

    if (code !== 0) {
      throw new Error(
        `Execution error (${code}): ${ffi.quasar_last_error() ?? "unknown"}`
      );
    }

    const resultPtr = ptrOut[0];
    const resultLen = Number(lenOut[0]);
    const resultBuf = Buffer.from(
      ffi.koffi.decode(resultPtr, "uint8_t", resultLen)
    );

    ffi.quasar_result_free(resultPtr, resultLen);
    return deserializeResult(resultBuf);
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/** Unpack a token account from execution result accounts. */
export function tokenAccount(result: ExecutionResult<KeyedAccountInfo>, pubkey: PublicKey): TokenAccountData | null {
  const acct = result.accounts.find(a => a.accountId.equals(pubkey));
  if (!acct) return null;
  return unpackTokenAccount(acct.accountInfo.data);
}

/** Unpack a mint from execution result accounts. */
export function mintAccount(result: ExecutionResult<KeyedAccountInfo>, pubkey: PublicKey): MintData | null {
  const acct = result.accounts.find(a => a.accountId.equals(pubkey));
  if (!acct) return null;
  return unpackMint(acct.accountInfo.data);
}

/** Assert the execution succeeded. Throws with logs on failure. */
export function assertSuccess(result: ExecutionResult<KeyedAccountInfo>): void {
  if (!result.status.ok) {
    const err = (result.status as { ok: false; error: ProgramError }).error;
    throw new Error(`expected success, got ${err.type}: ${JSON.stringify(err)}\n\nLogs:\n${result.logs.join("\n")}`);
  }
}

/** Assert the execution failed with a specific error. */
export function assertError(result: ExecutionResult<KeyedAccountInfo>, expected: ProgramError): void {
  if (result.status.ok) {
    throw new Error(`expected error ${JSON.stringify(expected)}, but execution succeeded`);
  }
  const actual = (result.status as { ok: false; error: ProgramError }).error;
  if (actual.type !== expected.type) {
    throw new Error(`expected error ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if ("code" in expected && "code" in actual && actual.code !== expected.code) {
    throw new Error(`expected error code ${expected.code}, got ${actual.code}`);
  }
}

// ---------------------------------------------------------------------------
// Token instruction builders
// ---------------------------------------------------------------------------

/** Build an SPL Token Transfer instruction. */
export function tokenTransfer(
  source: PublicKey, destination: PublicKey, authority: PublicKey,
  amount: bigint, tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): TransactionInstruction {
  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: tokenTransferData(amount),
  };
}

/** Build an SPL Token MintTo instruction. */
export function tokenMintTo(
  mint: PublicKey, destination: PublicKey, mintAuthority: PublicKey,
  amount: bigint, tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): TransactionInstruction {
  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
    ],
    data: tokenMintToData(amount),
  };
}

/** Build an SPL Token Burn instruction. */
export function tokenBurn(
  source: PublicKey, mint: PublicKey, authority: PublicKey,
  amount: bigint, tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): TransactionInstruction {
  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: tokenBurnData(amount),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenAccounts(accounts: KeyedAccountInfo[] | Record<string, KeyedAccountInfo>): KeyedAccountInfo[] {
  return Array.isArray(accounts) ? accounts : Object.values(accounts);
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

interface UserToken {
  mint: PublicKey;
  amount: bigint;
  tokenProgramId?: PublicKey;
}

/** A test user with a system account and optional token positions. */
export class User {
  readonly pubkey: PublicKey;
  private system: KeyedAccountInfo;
  private atas: Map<string, KeyedAccountInfo> = new Map();

  private constructor(pubkey: PublicKey, sol: bigint) {
    this.pubkey = pubkey;
    this.system = createSystemAccount(pubkey, sol);
  }

  /** Create a new test user with the given SOL balance and token positions. */
  static async create(sol: bigint, tokens: UserToken[] = []): Promise<User> {
    const kp = await Keypair.generate();
    const user = new User(kp.publicKey, sol);
    for (const t of tokens) {
      const programId = t.tokenProgramId ?? new PublicKey(SPL_TOKEN_PROGRAM_ID);
      const acct = createAssociatedTokenAccount(user.pubkey, t.mint, t.amount, programId);
      user.atas.set(t.mint.toBase58(), acct);
    }
    return user;
  }

  /** Get the ATA address for a given mint. */
  ata(mint: PublicKey): PublicKey {
    const acct = this.atas.get(mint.toBase58());
    if (acct) return acct.accountId;
    const [addr] = PublicKey.findProgramAddressSync(
      [this.pubkey.toBuffer(), new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
      new PublicKey(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
    );
    return addr;
  }

  /** Flatten all accounts (system + token) for processInstruction. */
  accounts(): KeyedAccountInfo[] {
    return [this.system, ...this.atas.values()];
  }
}

// ---------------------------------------------------------------------------
// Account factories
// ---------------------------------------------------------------------------

/** Create a system-owned account with the given lamports. */
export function createSystemAccount(pubkey: PublicKey, sol: bigint): KeyedAccountInfo {
  return {
    accountId: pubkey,
    accountInfo: {
      owner: new PublicKey(SYSTEM_PROGRAM_ID),
      lamports: sol,
      data: Buffer.alloc(0),
      executable: false,
    },
  };
}

/** Create a pre-initialized associated token account. Derives the ATA address automatically. */
export function createAssociatedTokenAccount(
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
  tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): KeyedAccountInfo {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    new PublicKey(SPL_ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  const data = packTokenAccount({
    mint: mint.toBuffer(),
    owner: owner.toBuffer(),
    amount,
  });
  return {
    accountId: ata,
    accountInfo: {
      owner: tokenProgramId,
      lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
      data,
      executable: false,
    },
  };
}

/** Create a pre-initialized token account (non-ATA). */
export function createTokenAccount(
  pubkey: PublicKey,
  opts: TokenAccountOpts,
  tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): KeyedAccountInfo {
  const data = packTokenAccount({
    mint: opts.mint.toBuffer(),
    owner: opts.owner.toBuffer(),
    amount: opts.amount,
    delegate: opts.delegate?.toBuffer(),
    state: opts.state,
    isNative: opts.isNative,
    delegatedAmount: opts.delegatedAmount,
    closeAuthority: opts.closeAuthority?.toBuffer(),
  });
  return {
    accountId: pubkey,
    accountInfo: {
      owner: tokenProgramId,
      lamports: rentMinimumBalance(TOKEN_ACCOUNT_LEN),
      data,
      executable: false,
    },
  };
}

/** Create a pre-initialized mint account. */
export function createMintAccount(
  pubkey: PublicKey,
  opts: MintOpts = {},
  tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID),
): KeyedAccountInfo {
  const data = packMint({
    mintAuthority: opts.mintAuthority?.toBuffer(),
    supply: opts.supply,
    decimals: opts.decimals,
    freezeAuthority: opts.freezeAuthority?.toBuffer(),
  });
  return {
    accountId: pubkey,
    accountInfo: {
      owner: tokenProgramId,
      lamports: rentMinimumBalance(MINT_LEN),
      data,
      executable: false,
    },
  };
}
