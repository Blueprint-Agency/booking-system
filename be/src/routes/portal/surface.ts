/**
 * Which portal a route module is mounted under. The mount names it, as
 * `scheduleRoutes('instructor')` under `/portal/instructor/schedule`: the
 * request body never does, and neither does the caller's Staff role, so an Admin
 * who calls an Instructor route is on the Instructor surface.
 *
 * A module shared by the two surfaces states what differs between them as data,
 * side by side, one entry per surface. Its handlers read their surface's entry
 * and never branch on the surface themselves. Instructor Permissions are not in
 * that data: they are applied where the Instructor subtree mounts the module,
 * before it (be/docs/adr/0012).
 */
export type Surface = 'admin' | 'instructor'
