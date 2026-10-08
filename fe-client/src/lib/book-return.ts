/**
 * Where a signed-out Book Now comes back to (fe-client-features §3.1).
 *
 * A visitor who taps Book Now is sent to sign in; once they have, they land on
 * the schedule with that class's Book sheet open, rather than on the schedule
 * with the class to find again. The class rides the sign-in's `next` as
 * `/?book=<id>`, and the schedule reads it back from its own address.
 */
const BOOK_PARAM = "book";
const CLASS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sign-in page for a signed-out Book Now on `classId`. */
export function bookSignInPath(classId: string): string {
  const next = `/?${new URLSearchParams({ [BOOK_PARAM]: classId }).toString()}`;
  return `/login?${new URLSearchParams({ next }).toString()}`;
}

/** The class whose Book sheet the schedule should open, if its address names one. */
export function classToBook(params: URLSearchParams): string | null {
  const id = params.get(BOOK_PARAM);
  return id && CLASS_ID.test(id) ? id : null;
}
