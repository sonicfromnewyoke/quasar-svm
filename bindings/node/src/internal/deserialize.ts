import { programErrorFromStatus } from "../index.js";
import type { ExecutionStatus } from "../index.js";
import type { InternalAccount, InternalResult } from "./types.js";

function skipAccountFields(data: Buffer, o: number): number {
  o += 32; // owner
  o += 8;  // lamports
  const dLen = data.readUInt32LE(o);
  o += 4;
  o += dLen; // data
  o += 1;    // executable
  return o;
}

export function deserializeResult(data: Buffer): InternalResult {
  let o = 0;

  const rawStatus = data.readInt32LE(o); o += 4;
  const computeUnits = data.readBigUInt64LE(o); o += 8;
  const executionTimeUs = data.readBigUInt64LE(o); o += 8;

  const rdLen = data.readUInt32LE(o); o += 4;
  const returnData = new Uint8Array(data.subarray(o, o + rdLen)); o += rdLen;

  const numAccts = data.readUInt32LE(o); o += 4;
  const accounts: InternalAccount[] = [];
  for (let i = 0; i < numAccts; i++) {
    const address = new Uint8Array(data.subarray(o, o + 32)); o += 32;
    const owner = new Uint8Array(data.subarray(o, o + 32)); o += 32;
    const lamports = data.readBigUInt64LE(o); o += 8;
    const dLen = data.readUInt32LE(o); o += 4;
    const acctData = new Uint8Array(data.subarray(o, o + dLen)); o += dLen;
    const executable = data[o++] !== 0;
    accounts.push({ address, owner, lamports, data: acctData, executable });
  }

  const numLogs = data.readUInt32LE(o); o += 4;
  const logs: string[] = [];
  for (let i = 0; i < numLogs; i++) {
    const lLen = data.readUInt32LE(o); o += 4;
    logs.push(data.subarray(o, o + lLen).toString("utf8"));
    o += lLen;
  }

  const emLen = data.readUInt32LE(o); o += 4;
  const errorMessage = emLen > 0 ? data.subarray(o, o + emLen).toString("utf8") : null;
  o += emLen;

  // Skip account diffs (still present in wire format)
  const numDiffs = data.readUInt32LE(o); o += 4;
  for (let i = 0; i < numDiffs; i++) {
    o += 32;
    o = skipAccountFields(data, o);
    o = skipAccountFields(data, o);
  }

  const status: ExecutionStatus =
    rawStatus === 0
      ? { ok: true as const }
      : { ok: false as const, error: programErrorFromStatus(rawStatus, errorMessage) };

  return { status, computeUnits, executionTimeUs, returnData, accounts, logs };
}
