/**
 * The rows of a Mindbody "Excel" export, which is an HTML table.
 *
 * The older Mindbody reports download as `.xls` files that are really HTML,
 * written by server templates rather than a serialiser. So this reads the
 * markup the way a browser would forgive it, not the way a parser would refuse
 * it:
 *
 *  - A row ends at `</tr>`, whether or not it began with `<tr>` — some reports
 *    drop the opening tag after a group row.
 *  - A cell runs from `<td>`/`<th>` to the next cell or the end of the row, so a
 *    stray `</a>` or an unclosed `<div>` inside it does no harm.
 *  - Text is entity-decoded (CJK names arrive as `&#NNNNN;`), and whitespace —
 *    template indentation, `&nbsp;`, trailing spaces — is collapsed and trimmed.
 *  - The first link in a cell is kept beside its text, because some reports
 *    carry a client's id only in `href="/app/clients/<id>/…"`.
 *
 * It knows nothing about any one report. Finding the header and deciding which
 * rows are data is each reader's job (`./readers.ts`).
 */

export type TableRow = {
  /** Cell text, decoded and trimmed. */
  cells: string[]
  /** The first `href` in each cell, or null. */
  links: (string | null)[]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** `&#26519;`, `&#x6797;`, `&amp;` — and Mindbody's own `&nbsp` with no semicolon. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function cellText(raw: string): string {
  const text = decodeEntities(raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
  // U+2060 (word joiner) turns up pasted into names; it is invisible and never data.
  return text.replace(/[\s ⁠​]+/g, ' ').trim()
}

export function readHtmlTable(html: string): TableRow[] {
  const rows: TableRow[] = []
  for (const chunk of html.split(/<\/tr\s*>/i)) {
    // Whatever precedes this row's first cell — its own `<tr>`, or the tail of
    // the table's opening markup — is not part of it.
    const cells = [...chunk.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|$)/gi)]
    if (cells.length === 0) continue
    rows.push({
      cells: cells.map(m => cellText(m[1]!)),
      links: cells.map(m => m[1]!.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? null),
    })
  }
  return rows
}
