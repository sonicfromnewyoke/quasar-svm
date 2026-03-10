import { getAddressEncoder, getAddressDecoder } from "@solana/addresses";
import type { AccountMeta } from "@solana/instructions";
import { isSignerRole, isWritableRole } from "@solana/instructions";
import { lamports } from "@solana/rpc-types";
import type { Instruction } from "@solana/instructions";
import type { KeyedAccount } from "./types.js";
import type { ExecutionResult } from "../index.js";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

// ---------------------------------------------------------------------------
// Serialization (JS -> wire format)
// ---------------------------------------------------------------------------

export function serializeInstruction(ix: Instruction): Buffer {
  const accounts = (ix.accounts ?? []) as readonly AccountMeta[];
  const data = ix.data ?? new Uint8Array(0);
  const metaSize = accounts.length * 34;
  const buf = Buffer.alloc(32 + 4 + data.length + 4 + metaSize);
  let o = 0;

  buf.set(addressEncoder.encode(ix.programAddress), o);
  o += 32;
  buf.writeUInt32LE(data.length, o);
  o += 4;
  buf.set(data, o);
  o += data.length;
  buf.writeUInt32LE(accounts.length, o);
  o += 4;

  for (const m of accounts) {
    buf.set(addressEncoder.encode(m.address), o);
    o += 32;
    buf[o++] = isSignerRole(m.role) ? 1 : 0;
    buf[o++] = isWritableRole(m.role) ? 1 : 0;
  }
  return buf;
}

export function serializeInstructions(ixs: Instruction[]): Buffer {
  const parts = ixs.map(serializeInstruction);
  const total = 4 + parts.reduce((s, p) => s + p.length, 0);
  const buf = Buffer.alloc(total);
  let o = 0;
  buf.writeUInt32LE(ixs.length, o);
  o += 4;
  for (const p of parts) {
    p.copy(buf, o);
    o += p.length;
  }
  return buf;
}

export function serializeAccounts(accounts: KeyedAccount[]): Buffer {
  let total = 4;
  for (const a of accounts) total += 32 + 32 + 8 + 4 + a.info.data.length + 1;

  const buf = Buffer.alloc(total);
  let o = 0;
  buf.writeUInt32LE(accounts.length, o);
  o += 4;

  for (const a of accounts) {
    buf.set(addressEncoder.encode(a.address), o);
    o += 32;
    buf.set(addressEncoder.encode(a.info.owner), o);
    o += 32;
    buf.writeBigUInt64LE(BigInt(a.info.lamports), o);
    o += 8;
    buf.writeUInt32LE(a.info.data.length, o);
    o += 4;
    buf.set(a.info.data, o);
    o += a.info.data.length;
    buf[o++] = a.info.executable ? 1 : 0;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Deserialization (wire format -> JS)
// ---------------------------------------------------------------------------

export function deserializeResult(data: Buffer): ExecutionResult<KeyedAccount> {
  let o = 0;

  const status = data.readInt32LE(o);
  o += 4;
  const computeUnits = data.readBigUInt64LE(o);
  o += 8;
  const executionTimeUs = data.readBigUInt64LE(o);
  o += 8;

  const rdLen = data.readUInt32LE(o);
  o += 4;
  const returnData = new Uint8Array(data.subarray(o, o + rdLen));
  o += rdLen;

  const numAccts = data.readUInt32LE(o);
  o += 4;
  const accounts: KeyedAccount[] = [];
  for (let i = 0; i < numAccts; i++) {
    const address = addressDecoder.decode(data.subarray(o, o + 32));
    o += 32;
    const owner = addressDecoder.decode(data.subarray(o, o + 32));
    o += 32;
    const rawLamports = data.readBigUInt64LE(o);
    o += 8;
    const dLen = data.readUInt32LE(o);
    o += 4;
    const acctData = new Uint8Array(data.subarray(o, o + dLen));
    o += dLen;
    const executable = data[o++] !== 0;
    accounts.push({
      address,
      info: { owner, lamports: lamports(rawLamports), data: acctData, executable },
    });
  }

  const numLogs = data.readUInt32LE(o);
  o += 4;
  const logs: string[] = [];
  for (let i = 0; i < numLogs; i++) {
    const lLen = data.readUInt32LE(o);
    o += 4;
    logs.push(data.subarray(o, o + lLen).toString("utf8"));
    o += lLen;
  }

  const emLen = data.readUInt32LE(o);
  o += 4;
  const errorMessage =
    emLen > 0 ? data.subarray(o, o + emLen).toString("utf8") : null;

  return {
    status,
    computeUnits,
    executionTimeUs,
    returnData,
    accounts,
    logs,
    errorMessage,
  };
}
