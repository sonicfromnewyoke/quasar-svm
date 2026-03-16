import { getAddressEncoder, getAddressDecoder } from "@solana/addresses";
import type { AccountMeta } from "@solana/instructions";
import { isSignerRole, isWritableRole } from "@solana/instructions";
import type { Instruction } from "@solana/instructions";
import type { Account } from "./types.js";
import type { AccountDiff, ExecutionStatus } from "../index.js";
import { programErrorFromStatus } from "../index.js";

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

export function serializeAccounts(accounts: Account[]): Buffer {
  let total = 4;
  for (const a of accounts) total += 32 + 32 + 8 + 4 + a.data.length + 1;

  const buf = Buffer.alloc(total);
  let o = 0;
  buf.writeUInt32LE(accounts.length, o);
  o += 4;

  for (const a of accounts) {
    buf.set(addressEncoder.encode(a.address), o);
    o += 32;
    buf.set(addressEncoder.encode(a.owner), o);
    o += 32;
    buf.writeBigUInt64LE(BigInt(a.lamports), o);
    o += 8;
    buf.writeUInt32LE(a.data.length, o);
    o += 4;
    buf.set(a.data, o);
    o += a.data.length;
    buf[o++] = a.executable ? 1 : 0;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Deserialization (wire format -> JS)
// ---------------------------------------------------------------------------

function readAccountFields(
  data: Buffer,
  o: number,
): { owner: string; lamports: bigint; data: Uint8Array; executable: boolean; offset: number } {
  const owner = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const lamports = data.readBigUInt64LE(o);
  o += 8;
  const dLen = data.readUInt32LE(o);
  o += 4;
  const acctData = new Uint8Array(data.subarray(o, o + dLen));
  o += dLen;
  const executable = data[o++] !== 0;
  return { owner, lamports, data: acctData, executable, offset: o };
}

export function deserializeResult(data: Buffer): {
  status: ExecutionStatus;
  computeUnits: bigint;
  executionTimeUs: bigint;
  returnData: Uint8Array;
  accounts: Account[];
  modifiedAccounts: AccountDiff<Account>[];
  logs: string[];
} {
  let o = 0;

  const rawStatus = data.readInt32LE(o);
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
  const accounts: Account[] = [];
  for (let i = 0; i < numAccts; i++) {
    const address = addressDecoder.decode(data.subarray(o, o + 32));
    o += 32;
    const fields = readAccountFields(data, o);
    o = fields.offset;
    accounts.push({
      address: address as Account["address"],
      owner: fields.owner as Account["owner"],
      lamports: fields.lamports,
      data: fields.data,
      executable: fields.executable,
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
  const errorMessage = emLen > 0 ? data.subarray(o, o + emLen).toString("utf8") : null;
  o += emLen;

  // Modified accounts (account diffs)
  const numDiffs = data.readUInt32LE(o);
  o += 4;
  const modifiedAccounts: AccountDiff<Account>[] = [];
  for (let i = 0; i < numDiffs; i++) {
    const diffAddress = addressDecoder.decode(data.subarray(o, o + 32));
    o += 32;
    const pre = readAccountFields(data, o);
    o = pre.offset;
    const post = readAccountFields(data, o);
    o = post.offset;
    modifiedAccounts.push({
      address: diffAddress as Account["address"],
      pre: {
        address: diffAddress as Account["address"],
        owner: pre.owner as Account["owner"],
        lamports: pre.lamports,
        data: pre.data,
        executable: pre.executable,
      },
      post: {
        address: diffAddress as Account["address"],
        owner: post.owner as Account["owner"],
        lamports: post.lamports,
        data: post.data,
        executable: post.executable,
      },
    });
  }

  const status: ExecutionStatus =
    rawStatus === 0
      ? { ok: true as const }
      : { ok: false as const, error: programErrorFromStatus(rawStatus, errorMessage) };

  return { status, computeUnits, executionTimeUs, returnData, accounts, modifiedAccounts, logs };
}
