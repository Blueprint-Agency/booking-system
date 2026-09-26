/**
 * A placeholder address on the reserved `.invalid` TLD: someone imported with no
 * email of their own, who teaches and is paid but has no login to send a link to.
 * The backend's rule is the same (`be/src/services/auth/account-access.ts`).
 */
export const isPlaceholderEmail = (email: string) => /\.invalid$/i.test(email.trim());
