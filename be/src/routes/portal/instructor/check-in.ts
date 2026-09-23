import { checkInRoutes } from '../check-in-routes'

/**
 * Instructor check-in (spec §11 — "instructor scoped to own sessions").
 * Same routes as the admin path; `source: 'instructor'` makes the service
 * assert the caller is the session's MAIN instructor, and list only theirs.
 */
export default checkInRoutes('instructor')
