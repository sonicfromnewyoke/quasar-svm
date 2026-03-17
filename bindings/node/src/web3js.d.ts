/**
 * Ambient type declarations for @solana/web3.js v2 (git:blueshift-gg/solana-web3.js#v2).
 * The git dependency doesn't ship pre-built declarations, so we declare the types we use.
 */
declare module "@solana/web3.js" {
  export type AddressInitData =
    | number
    | bigint
    | string
    | Uint8Array
    | Array<number>
    | Address;

  export class Address {
    constructor(value: AddressInitData);
    static unique(): Address;
    static default: Address;
    static findProgramAddressSync(
      seeds: Array<Buffer | Uint8Array>,
      programId: Address,
    ): [Address, number];
    equals(other: Address): boolean;
    toBase58(): string;
    toBuffer(): Buffer;
    toBytes(): Uint8Array;
    toString(): string;
  }

  export { Address as PublicKey };

  export type AccountMeta = {
    pubkey: Address;
    isSigner: boolean;
    isWritable: boolean;
  };

  export class TransactionInstruction {
    keys: AccountMeta[];
    programId: Address;
    data: Buffer;
    constructor(opts: {
      keys: AccountMeta[];
      programId: Address;
      data?: Buffer;
    });
  }

  export interface AccountInfo<T> {
    executable: boolean;
    owner: Address;
    lamports: number | bigint;
    data: T;
  }

  export type KeyedAccountInfo = {
    accountId: Address;
    accountInfo: AccountInfo<Buffer>;
  };

  export class Keypair {
    static generate(): Promise<Keypair>;
    readonly publicKey: Address;
    readonly secretKey: Uint8Array;
  }
}
