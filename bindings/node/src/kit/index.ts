import type { Address } from "@solana/addresses";
import { getAddressEncoder } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import * as ffi from "../ffi.js";
import {
  serializeInstruction,
  serializeInstructions,
  serializeAccounts,
  deserializeResult,
} from "./wire.js";
import type {
  ExecutionResult,
  Clock,
  EpochSchedule,
} from "../index.js";
import type { KeyedAccount } from "./types.js";

export type { KitExecutionResult, AccountInfo, KeyedAccount } from "./types.js";
export type { ExecutionResult, Clock, EpochSchedule } from "../index.js";

const addressEncoder = getAddressEncoder();

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

  addProgram(programId: Address, elf: Uint8Array): void {
    this.check(
      ffi.quasar_svm_add_program(
        this.ptr,
        Buffer.from(addressEncoder.encode(programId)),
        Buffer.from(elf),
        elf.length
      )
    );
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

  processInstruction(
    instruction: Instruction,
    accounts: KeyedAccount[]
  ): ExecutionResult<KeyedAccount> {
    return this.exec(
      ffi.quasar_svm_process_instruction,
      serializeInstruction(instruction),
      serializeAccounts(accounts)
    );
  }

  processInstructionChain(
    instructions: Instruction[],
    accounts: KeyedAccount[]
  ): ExecutionResult<KeyedAccount> {
    return this.exec(
      ffi.quasar_svm_process_instruction_chain,
      serializeInstructions(instructions),
      serializeAccounts(accounts)
    );
  }

  processTransaction(
    instructions: Instruction[],
    accounts: KeyedAccount[]
  ): ExecutionResult<KeyedAccount> {
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
  ): ExecutionResult<KeyedAccount> {
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
