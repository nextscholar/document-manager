/**
 * Jest mock for expo-crypto.
 *
 * Provides deterministic implementations of the crypto functions used in
 * auth.tsx so that unit tests are reproducible and don't depend on native
 * modules.
 */

export enum CryptoDigestAlgorithm {
  SHA1 = 'SHA-1',
  SHA256 = 'SHA-256',
  SHA384 = 'SHA-384',
  SHA512 = 'SHA-512',
  MD2 = 'MD2',
  MD4 = 'MD4',
  MD5 = 'MD5',
}

export enum CryptoEncoding {
  HEX = 'hex',
  BASE64 = 'base64',
}

/** Returns a fixed byte sequence so PKCE values are reproducible in tests. */
export const getRandomBytes = jest.fn((byteCount: number): Uint8Array => {
  return new Uint8Array(byteCount).fill(0x42);
});

/** Returns a fixed base64 digest so code_challenge is reproducible in tests. */
export const digestStringAsync = jest.fn(
  async (
    _algorithm: CryptoDigestAlgorithm,
    _data: string,
    _options?: { encoding: CryptoEncoding },
  ): Promise<string> => {
    return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  },
);

export const getRandomBytesAsync = jest.fn(
  async (byteCount: number): Promise<Uint8Array> => new Uint8Array(byteCount).fill(0x42),
);

export const randomUUID = jest.fn(() => '00000000-0000-0000-0000-000000000000');
