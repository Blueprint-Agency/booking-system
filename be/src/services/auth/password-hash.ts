import bcrypt from 'bcryptjs'
import { verifyPassword } from 'better-auth/crypto'

/**
 * How the staff and platform pools check a password: Better Auth's own scrypt
 * hash, or a bcrypt digest carried over from Clerk (#120).
 *
 * Clerk exports its password digests as bcrypt, and the import writes them onto
 * the credential account as they are (`clerk-import.ts`), so a staff member
 * keeps the password they had rather than being sent a reset. The two formats
 * cannot be confused: bcrypt's modular-crypt string starts `$2a$`/`$2b$`/`$2y$`,
 * Better Auth's is `salt:key` in hex.
 *
 * Hashing a new password is left to Better Auth, so a digest is bcrypt only
 * until its owner next sets a password, and the reset or change writes scrypt.
 */
export function isBcryptDigest(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash)
}

export async function verifyPoolPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (isBcryptDigest(hash)) return bcrypt.compare(password, hash)
  return verifyPassword({ hash, password })
}
