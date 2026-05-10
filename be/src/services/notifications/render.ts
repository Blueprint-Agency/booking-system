/**
 * Simple {{variable}} substitution with HTML-escaping of values.
 * Body HTML itself is trusted (admin-edited rich text); only the substituted
 * values get escaped to prevent injection.
 */
const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = variables[key]
    if (value === undefined) return ''
    return value.replace(/[&<>"']/g, ch => ESCAPE[ch] ?? ch)
  })
}
