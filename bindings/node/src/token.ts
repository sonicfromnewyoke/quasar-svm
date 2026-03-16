// ---------------------------------------------------------------------------
// SPL Token encoding (delegates to @solana-program/token) and raw decoding
// ---------------------------------------------------------------------------

import {
  getMintEncoder,
  getTokenEncoder,
  getMintSize,
  getTokenSize,
  type MintArgs,
  type TokenArgs,
} from "@solana-program/token";

export type { MintArgs, TokenArgs };

export const MINT_LEN = getMintSize();
export const TOKEN_ACCOUNT_LEN = getTokenSize();

const mintEncoder = getMintEncoder();
const tokenEncoder = getTokenEncoder();

/** Default Solana rent: minimum_balance(data_len) = (data_len + 128) * 3480 * 2 */
export function rentMinimumBalance(dataLen: number): bigint {
  return BigInt(dataLen + 128) * 3480n * 2n;
}

export function packMint(args: MintArgs): Uint8Array {
  return new Uint8Array(mintEncoder.encode(args));
}

export function packTokenAccount(args: TokenArgs): Uint8Array {
  return new Uint8Array(tokenEncoder.encode(args));
}

// ---------------------------------------------------------------------------
// Raw unpack — returns Uint8Array for address fields (used by result.ts)
// ---------------------------------------------------------------------------

export enum TokenAccountState {
  Uninitialized = 0,
  Initialized = 1,
  Frozen = 2,
}

export interface RawMintData {
  mintAuthority?: Uint8Array;
  supply: bigint;
  decimals: number;
  freezeAuthority?: Uint8Array;
}

export interface RawTokenAccountData {
  mint: Uint8Array;
  owner: Uint8Array;
  amount: bigint;
  delegate?: Uint8Array;
  state: TokenAccountState;
  isNative?: bigint;
  delegatedAmount: bigint;
  closeAuthority?: Uint8Array;
}

export function unpackMint(data: Uint8Array): RawMintData | null {
  if (data.length < MINT_LEN) return null;
  const buf = Buffer.from(data);
  let o = 0;
  const [mintAuthority, o1] = unpackCOptionPubkey(buf, o); o = o1;
  const supply = buf.readBigUInt64LE(o); o += 8;
  const decimals = buf[o]; o += 1;
  const isInitialized = buf[o] !== 0; o += 1;
  if (!isInitialized) return null;
  const [freezeAuthority, o2] = unpackCOptionPubkey(buf, o); o = o2;
  return { mintAuthority: mintAuthority ?? undefined, supply, decimals, freezeAuthority: freezeAuthority ?? undefined };
}

export function unpackTokenAccount(data: Uint8Array): RawTokenAccountData | null {
  if (data.length < TOKEN_ACCOUNT_LEN) return null;
  const buf = Buffer.from(data);
  let o = 0;
  const mint = new Uint8Array(buf.subarray(o, o + 32)); o += 32;
  const owner = new Uint8Array(buf.subarray(o, o + 32)); o += 32;
  const amount = buf.readBigUInt64LE(o); o += 8;
  const [delegate, o1] = unpackCOptionPubkey(buf, o); o = o1;
  const state = buf[o] as TokenAccountState; o += 1;
  const [isNativeRaw, o2] = unpackCOptionU64(buf, o); o = o2;
  const delegatedAmount = buf.readBigUInt64LE(o); o += 8;
  const [closeAuthority, o3] = unpackCOptionPubkey(buf, o); o = o3;
  return {
    mint, owner, amount,
    delegate: delegate ?? undefined,
    state,
    isNative: isNativeRaw ?? undefined,
    delegatedAmount,
    closeAuthority: closeAuthority ?? undefined,
  };
}

function unpackCOptionPubkey(buf: Buffer, offset: number): [Uint8Array | null, number] {
  const tag = buf.readUInt32LE(offset);
  const key = new Uint8Array(buf.subarray(offset + 4, offset + 36));
  return [tag === 1 ? key : null, offset + 36];
}

function unpackCOptionU64(buf: Buffer, offset: number): [bigint | null, number] {
  const tag = buf.readUInt32LE(offset);
  const val = buf.readBigUInt64LE(offset + 4);
  return [tag === 1 ? val : null, offset + 12];
}
