export function splitName(full: string): { firstName: string; lastName: string | null } {
  const trimmed = full.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { firstName: '', lastName: null }
  const i = trimmed.indexOf(' ')
  if (i === -1) return { firstName: trimmed, lastName: null }
  return { firstName: trimmed.slice(0, i), lastName: trimmed.slice(i + 1) }
}

export function joinName(firstName: string, lastName?: string | null): string {
  return [firstName.trim(), (lastName ?? '').trim()].filter(Boolean).join(' ')
}
