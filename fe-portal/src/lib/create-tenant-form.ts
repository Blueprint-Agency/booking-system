/**
 * Whether the New studio form may be submitted. Kept apart from the dialog so
 * the rule can be tried without rendering it.
 *
 * Every field the studio cannot be created without must be present: a name, an
 * available address, and a time zone, which is fixed once the studio exists and
 * so is never left to a default.
 */
export function canCreateStudio(form: {
  submitting: boolean;
  name: string;
  slug: string;
  slugAvailable: boolean;
  prefixError: string | null | undefined;
  timezone: string;
}): boolean {
  return (
    !form.submitting &&
    Boolean(form.name.trim()) &&
    Boolean(form.slug) &&
    Boolean(form.timezone.trim()) &&
    form.slugAvailable &&
    !form.prefixError
  );
}
