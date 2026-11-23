/**
 * Versioned password-verifier format.
 *
 * Existing YoungMoney3 users have unprefixed 32-byte PBKDF2-HMAC-SHA256
 * digests with 100,000 iterations and a separate base64 salt. Do not replace
 * their parameters without verifying first: doing so locks out real members.
 *
 * New credentials use PBKDF2-HMAC-SHA256 at 600,000 iterations. The scheme
 * and work factor travel with the stored hash, allowing future upgrades
 * without schema changes. The separate random salt remains 16 bytes.
 */
const encoder = new TextEncoder();
const algorithm = 'pbkdf2-sha256';
const legacyIterations = 100000;
export const PASSWORD_ITERATIONS = 600000;
const maximumAcceptedIterations = 1200000;

function bytes64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function decode64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const decoded = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    return bytes64(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt, PASSWORD_ITERATIONS);
  return {
    salt: bytes64(salt),
    hash: algorithm + '$' + PASSWORD_ITERATIONS + '$' + bytes64(digest),
  };
}

/** Avoid secret-dependent short circuiting on the digest comparison. */
function equalsDigest(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.byteLength !== 32 || expected.byteLength !== 32) return false;
  let mismatch = 0;
  for (let i = 0; i < 32; i++) mismatch |= actual[i] ^ expected[i];
  return mismatch === 0;
}

export async function verifyPassword(
  password: string, encodedSalt: unknown, encodedHash: unknown
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  const invalid = { valid: false, needsUpgrade: false };
  if (typeof password !== 'string' || typeof encodedSalt !== 'string' ||
      typeof encodedHash !== 'string' || password.length > 4096) return invalid;

  const salt = decode64(encodedSalt);
  if (!salt || salt.length < 16 || salt.length > 64) return invalid;

  let iterations = legacyIterations;
  let digestString = encodedHash;
  let isLegacy = true;
  if (encodedHash.includes('$')) {
    const match = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9+/]+=*)$/.exec(encodedHash);
    if (!match) return invalid;
    iterations = Number(match[1]);
    digestString = match[2];
    isLegacy = false;
    // Never consume a user- or corrupted-record-selected unbounded work factor.
    if (iterations < legacyIterations || iterations > maximumAcceptedIterations) return invalid;
  }
  const expected = decode64(digestString);
  if (!expected || expected.length !== 32) return invalid;
  const candidate = await derive(password, salt, iterations);
  const valid = equalsDigest(candidate, expected);
  return { valid, needsUpgrade: valid && (isLegacy || iterations < PASSWORD_ITERATIONS) };
}
