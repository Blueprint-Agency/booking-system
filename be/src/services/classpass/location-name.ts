/**
 * A ClassPass location name as it is stored and matched (#410, #411).
 *
 * ClassPass writes a studio's location name in its emails, but not always the
 * same way: `<Studio>-<Location>` in one email, `<Studio> - <Location>` or
 * an en dash in the next, and sometimes cut short to `<Studio> -`. So a
 * ClassPass location mapping is stored under this form, and an email's
 * location is put in this form before it is looked up:
 *
 * - lower-cased;
 * - every dash or hyphen (`-`, `‐`, `‑`, `‒`, `–`, `—`, `―`, `−`) is `-`, with one
 *   space either side of it;
 * - runs of whitespace are one space, and none leads or trails.
 *
 * So `Northwind-Harbour St` and `northwind – harbour  st` are one name,
 * `northwind - harbour st`.
 */
export function normaliseClassPassLocation(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−-]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
}
