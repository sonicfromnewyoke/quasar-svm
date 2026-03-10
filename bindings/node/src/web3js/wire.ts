import { type TransactionInstruction, type KeyedAccountInfo, PublicKey } from "@solana/web3.js";
import type { ExecutionResult } from "../index.js";

// ---------------------------------------------------------------------------
// Serialization (JS -> wire format)
// ---------------------------------------------------------------------------

export function serializeInstruction(ix: TransactionInstruction): Buffer {
  const keys = ix.keys;
  const data = ix.data;
  const metaSize = keys.length * 34;
  const buf = Buffer.alloc(32 + 4 + data.length + 4 + metaSize);
  let o = 0;

  buf.set(ix.programId.toBuffer(), o);
  o += 32;
  buf.writeUInt32LE(data.length, o);
  o += 4;
  buf.set(data, o);
  o += data.length;
  buf.writeUInt32LE(keys.length, o);
  o += 4;

  for (const m of keys) {
    buf.set(m.pubkey.toBuffer(), o);
    o += 32;
    buf[o++] = m.isSigner ? 1 : 0;
    buf[o++] = m.isWritable ? 1 : 0;
  }
  return buf;
}

export function serializeInstructions(ixs: TransactionInstruction[]): Buffer {
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

export function serializeAccounts(accounts: KeyedAccountInfo[]): Buffer {
  let total = 4;
  for (const a of accounts) total += 32 + 32 + 8 + 4 + a.accountInfo.data.length + 1;

  const buf = Buffer.alloc(total);
  let o = 0;
  buf.writeUInt32LE(accounts.length, o);
  o += 4;

  for (const a of accounts) {
    buf.set(a.accountId.toBuffer(), o);
    o += 32;
    buf.set(a.accountInfo.owner.toBuffer(), o);
    o += 32;
    buf.writeBigUInt64LE(BigInt(a.accountInfo.lamports), o);
    o += 8;
    buf.writeUInt32LE(a.accountInfo.data.length, o);
    o += 4;
    buf.set(a.accountInfo.data, o);
    o += a.accountInfo.data.length;
    buf[o++] = a.accountInfo.executable ? 1 : 0;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Deserialization (wire format -> JS)
// ---------------------------------------------------------------------------

export function deserializeResult(data: Buffer): ExecutionResult<KeyedAccountInfo> {
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
  const accounts: KeyedAccountInfo[] = [];
  for (let i = 0; i < numAccts; i++) {
    const accountId = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const owner = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const lamports = data.readBigUInt64LE(o);
    o += 8;
    const dLen = data.readUInt32LE(o);
    o += 4;
    const acctData = Buffer.from(data.subarray(o, o + dLen));
    o += dLen;
    const executable = data[o++] !== 0;
    accounts.push({ accountId, accountInfo: { owner, lamports, data: acctData, executable } });
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
