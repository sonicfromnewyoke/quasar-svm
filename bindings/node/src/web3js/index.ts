import { PublicKey } from "@solana/web3.js";
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
  LOADER_V2,
  LOADER_V3,
  loadElf,
} from "../programs.js";
import { packMint, packTokenAccount, rentMinimumBalance, MINT_LEN, TOKEN_ACCOUNT_LEN } from "../token.js";
import type { TokenAccountState } from "../token.js";

export type { Web3ExecutionResult } from "./types.js";
export type { ExecutionResult, ExecutionStatus, ProgramError, Clock, EpochSchedule } from "../index.js";
export { SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, LOADER_V2, LOADER_V3 } from "../programs.js";
export { TokenAccountState } from "../token.js";
export type { MintData, TokenAccountData } from "../token.js";

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

  /** Store a pre-initialized SPL Token mint account. */
  addMintAccount(
    pubkey: PublicKey,
    opts: {
      mintAuthority?: PublicKey;
      supply?: bigint;
      decimals?: number;
      freezeAuthority?: PublicKey;
    }
  ): void {
    const data = packMint({
      mintAuthority: opts.mintAuthority?.toBuffer(),
      supply: opts.supply,
      decimals: opts.decimals,
      freezeAuthority: opts.freezeAuthority?.toBuffer(),
    });
    const tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID);
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        pubkey.toBuffer(),
        tokenProgramId.toBuffer(),
        rentMinimumBalance(MINT_LEN),
        data,
        MINT_LEN,
        false
      )
    );
  }

  /** Store a pre-initialized SPL Token token account. */
  addTokenAccount(
    pubkey: PublicKey,
    opts: {
      mint: PublicKey;
      owner: PublicKey;
      amount: bigint;
      delegate?: PublicKey;
      state?: TokenAccountState;
      isNative?: bigint;
      delegatedAmount?: bigint;
      closeAuthority?: PublicKey;
    }
  ): void {
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
    const tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ID);
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        pubkey.toBuffer(),
        tokenProgramId.toBuffer(),
        rentMinimumBalance(TOKEN_ACCOUNT_LEN),
        data,
        TOKEN_ACCOUNT_LEN,
        false
      )
    );
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
    accounts: KeyedAccountInfo[]
  ): ExecutionResult<KeyedAccountInfo> {
    return this.exec(
      ffi.quasar_svm_simulate_transaction,
      serializeInstructions(instructions),
      serializeAccounts(accounts)
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
    accounts: KeyedAccountInfo[]
  ): ExecutionResult<KeyedAccountInfo> {
    const ixs = Array.isArray(instructions) ? instructions : [instructions];
    return this.exec(
      ffi.quasar_svm_process_instructions,
      serializeInstructions(ixs),
      serializeAccounts(accounts)
    );
  }

  processTransaction(
    instructions: TransactionInstruction[],
    accounts: KeyedAccountInfo[]
  ): ExecutionResult<KeyedAccountInfo> {
    return this.exec(
      ffi.quasar_svm_process_transaction,
      serializeInstructions(instructions),
      serializeAccounts(accounts)
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
