import type { Address } from "@solana/addresses";
import { address, getAddressEncoder, getAddressDecoder } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import { lamports } from "@solana/rpc-types";
import * as ffi from "../ffi.js";
import {
  serializeInstructions,
  serializeAccounts,
  deserializeResult,
} from "./wire.js";
import type {
  ExecutionResult,
  Clock,
  EpochSchedule,
} from "../index.js";
import type { SvmAccount } from "./types.js";
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

export type { KitExecutionResult, SvmAccount } from "./types.js";
export type { ExecutionResult, ExecutionStatus, ProgramError, Clock, EpochSchedule } from "../index.js";
export { SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID, LOADER_V2, LOADER_V3 } from "../programs.js";
export { TokenAccountState } from "../token.js";
export type { MintData, TokenAccountData } from "../token.js";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

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

  addSystemProgram(): this {
    return this;
  }

  /** Give lamports to an account, creating it if it doesn't exist. */
  airdrop(pubkey: Address, amount: bigint): void {
    this.check(
      ffi.quasar_svm_airdrop(
        this.ptr,
        Buffer.from(addressEncoder.encode(pubkey)),
        amount
      )
    );
  }

  /** Create a rent-exempt account with the given space and owner. */
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

  /** Store a pre-initialized SPL Token mint account. */
  addMintAccount(
    pubkey: Address,
    opts: {
      mintAuthority?: Address;
      supply?: bigint;
      decimals?: number;
      freezeAuthority?: Address;
    }
  ): void {
    const enc = (a: Address) => new Uint8Array(addressEncoder.encode(a));
    const data = packMint({
      mintAuthority: opts.mintAuthority ? enc(opts.mintAuthority) : undefined,
      supply: opts.supply,
      decimals: opts.decimals,
      freezeAuthority: opts.freezeAuthority ? enc(opts.freezeAuthority) : undefined,
    });
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        Buffer.from(enc(pubkey)),
        Buffer.from(enc(address(SPL_TOKEN_PROGRAM_ID))),
        rentMinimumBalance(MINT_LEN),
        data,
        MINT_LEN,
        false
      )
    );
  }

  /** Store a pre-initialized SPL Token token account. */
  addTokenAccount(
    pubkey: Address,
    opts: {
      mint: Address;
      owner: Address;
      amount: bigint;
      delegate?: Address;
      state?: TokenAccountState;
      isNative?: bigint;
      delegatedAmount?: bigint;
      closeAuthority?: Address;
    }
  ): void {
    const enc = (a: Address) => new Uint8Array(addressEncoder.encode(a));
    const data = packTokenAccount({
      mint: enc(opts.mint),
      owner: enc(opts.owner),
      amount: opts.amount,
      delegate: opts.delegate ? enc(opts.delegate) : undefined,
      state: opts.state,
      isNative: opts.isNative,
      delegatedAmount: opts.delegatedAmount,
      closeAuthority: opts.closeAuthority ? enc(opts.closeAuthority) : undefined,
    });
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        Buffer.from(enc(pubkey)),
        Buffer.from(enc(address(SPL_TOKEN_PROGRAM_ID))),
        rentMinimumBalance(TOKEN_ACCOUNT_LEN),
        data,
        TOKEN_ACCOUNT_LEN,
        false
      )
    );
  }

  /** Store an account in the SVM's persistent account database. */
  setAccount(account: SvmAccount): void {
    const dataBuf = account.data.length > 0 ? Buffer.from(account.data) : null;
    this.check(
      ffi.quasar_svm_set_account(
        this.ptr,
        Buffer.from(addressEncoder.encode(account.address)),
        Buffer.from(addressEncoder.encode(account.programAddress)),
        BigInt(account.lamports),
        dataBuf,
        account.data.length,
        account.executable
      )
    );
  }

  /** Read an account from the SVM's persistent account database. */
  getAccount(pubkey: Address): SvmAccount | null {
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

    // Deserialize: [32] pubkey [32] owner [8] lamports [4] data_len [N] data [1] executable
    let o = 0;
    const acctAddress = addressDecoder.decode(buf.subarray(o, o + 32));
    o += 32;
    const programAddress = addressDecoder.decode(buf.subarray(o, o + 32));
    o += 32;
    const rawLamports = buf.readBigUInt64LE(o);
    o += 8;
    const dLen = buf.readUInt32LE(o);
    o += 4;
    const data = new Uint8Array(buf.subarray(o, o + dLen));
    o += dLen;
    const executable = buf[o] !== 0;

    return {
      address: acctAddress,
      data,
      executable,
      lamports: lamports(rawLamports),
      programAddress,
      space: BigInt(dLen),
    };
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
    this.check(ffi.quasar_svm_set_rent(this.ptr, lamportsPerByte, 1.0, 0));
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

  /** Execute a transaction without committing any state changes. */
  simulateTransaction(
    instructions: Instruction[],
    accounts: SvmAccount[]
  ): ExecutionResult<SvmAccount> {
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

  processInstruction(
    instructions: Instruction | Instruction[],
    accounts: SvmAccount[]
  ): ExecutionResult<SvmAccount> {
    const ixs = Array.isArray(instructions) ? instructions : [instructions];
    return this.exec(
      ffi.quasar_svm_process_instructions,
      serializeInstructions(ixs),
      serializeAccounts(accounts)
    );
  }

  processTransaction(
    instructions: Instruction[],
    accounts: SvmAccount[]
  ): ExecutionResult<SvmAccount> {
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
  ): ExecutionResult<SvmAccount> {
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
