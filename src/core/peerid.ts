/**
 * IPFS PeerID <-> bytes32 conversions (vendored from user's snippet).
 *
 * PeerIDs are 34-byte multihashes: 2-byte prefix (0x1220) + 32-byte digest.
 * On-chain storage uses only the 32-byte digest; this module reconstructs the
 * full PeerID off-chain.
 *
 * NOTE: In the current distributor we mainly DON'T need to convert back to
 * PeerID strings — the calls to `submitStorageRewardsBatch` take bytes32. But
 * the conversion is here for log readability and any UI display purposes.
 */
import { hexlify, getBytes } from "ethers";

// We need a base58 codec. Use a tiny inline implementation to avoid a heavy
// dependency. Same alphabet as Bitcoin / IPFS.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  BASE58_MAP[BASE58_ALPHABET[i]] = i;
}

function base58Encode(bytes: Uint8Array): string {
  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = "";
  for (let i = 0; i < zeros; i++) result += "1";
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array();
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  const b256: number[] = [];
  for (let i = zeros; i < str.length; i++) {
    const v = BASE58_MAP[str[i]];
    if (v === undefined) throw new Error(`Invalid base58 char: ${str[i]}`);
    let carry = v;
    for (let j = 0; j < b256.length; j++) {
      carry += b256[j] * 58;
      b256[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      b256.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + b256.length);
  for (let i = 0; i < b256.length; i++) {
    out[zeros + i] = b256[b256.length - 1 - i];
  }
  return out;
}

const base58btc = {
  encode: (bytes: Uint8Array) => "z" + base58Encode(bytes), // multibase prefix
  decode: (input: string) => base58Decode(input.startsWith("z") ? input.slice(1) : input),
};

/**
 * Converts a full IPFS PeerID to bytes32 digest for on-chain storage.
 * Supports both CIDv1 (Ed25519) and 34-byte multihash PeerIDs.
 */
export function peerIdToBytes32(peerId: string): string {
  try {
    let multibase = peerId.startsWith("z") ? peerId : `z${peerId}`;
    const decoded = base58btc.decode(multibase);

    let bytes32: string | undefined;

    // CIDv1 (Ed25519 public key) format
    const CID_HEADER = [0x00, 0x24, 0x08, 0x01, 0x12];
    const isCIDv1 = CID_HEADER.every((v, i) => decoded[i] === v);
    if (isCIDv1 && decoded.length >= 37) {
      const pubkey = decoded.slice(decoded.length - 32);
      bytes32 = hexlify(pubkey);
    }

    // Legacy multihash format
    if (decoded.length === 34 && decoded[0] === 0x12 && decoded[1] === 0x20) {
      const digest = decoded.slice(2);
      bytes32 = hexlify(digest);
    }

    if (!bytes32) {
      throw new Error(`Unsupported PeerID format or unexpected length: ${decoded.length}`);
    }

    // Reversible check
    const reconstructed = bytes32ToPeerId(bytes32);
    if (reconstructed !== multibase.slice(1)) {
      throw new Error(
        `Could not revert the encoded bytes32 back to original PeerID. Got: ${reconstructed}`,
      );
    }

    return bytes32;
  } catch (err) {
    throw new Error(
      `peerIdToBytes32 failed for ${peerId}: ${(err as Error)?.message ?? err}`,
    );
  }
}

/**
 * Reconstructs the full Base58 PeerID from a bytes32 digest.
 * Always returns a multibase-style PeerID (WITHOUT the 'z' prefix by default,
 * matching legacy display style).
 */
export function bytes32ToPeerId(digestBytes32: string): string {
  try {
    const pubkeyBytes = getBytes(digestBytes32);
    const full = Uint8Array.from([
      0x00, 0x24, // CIDv1 prefix
      0x08, 0x01, // ed25519-pub key
      0x12, 0x20, // multihash: sha2-256, 32 bytes
      ...pubkeyBytes,
    ]);
    return base58btc.encode(full).slice(1);
  } catch (err) {
    return digestBytes32; // graceful fallback so callers don't blow up on logging
  }
}
