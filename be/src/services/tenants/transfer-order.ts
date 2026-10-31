/**
 * The order a Tenant's tables may be written back in, and the columns that
 * cannot be written on the first pass.
 *
 * Restoring a studio is not "insert 54 tables". A row that points at another
 * row has to arrive after it, or the foreign key refuses it — so the tables
 * have to be sorted by their dependencies, and three of them point at
 * *themselves* (`clients.referred_by_client_id`, `staff_users.archived_by_staff_id`,
 * `class_types.parent_id`), which no ordering of tables can fix.
 *
 * Both problems are solved here, as pure functions over an edge list the caller
 * reads from the Postgres catalogue. Reading the graph from the catalogue rather
 * than hardcoding it is the whole point: a table added by a later migration is
 * ordered correctly without anyone remembering this file exists.
 */

/** A foreign key: `child` cannot be written until `parent` has been. */
export type ForeignKey = {
  child: string
  parent: string
  /** The child's column holding the reference. */
  column: string
  /** False when the column may be left NULL on a first pass. */
  required: boolean
}

type TableOrder = {
  /** Tables, parents first. Every table given is present exactly once. */
  order: string[]
  /**
   * Columns to write as NULL on the insert pass and fill in afterwards, keyed by
   * table. These are the references no ordering can satisfy — a cycle — and they
   * are only ever nullable columns, because a required one would make the cycle
   * genuinely unsatisfiable and is reported instead.
   */
  deferred: Record<string, string[]>
  /**
   * Cycles that could not be broken, because every edge in them is required.
   * Empty in a healthy schema; non-empty means a restore would be impossible and
   * the caller must say so rather than write a corrupt studio.
   */
  unbreakable: string[][]
}

/**
 * Sort tables parents-first, breaking cycles by deferring nullable references.
 *
 * Kahn's algorithm, with one addition: when nothing is left with zero
 * dependencies but tables remain, the graph has a cycle. Rather than fail, a
 * nullable edge in that cycle is removed and recorded as deferred, one at a
 * time until the order resolves — which is exactly what a self-reference is, a
 * cycle of length one.
 */
export function orderTables(tables: readonly string[], foreignKeys: readonly ForeignKey[]): TableOrder {
  const remaining = new Set(tables);
  // Only edges between tables we are actually moving matter. A reference to
  // something outside the set (the `tenants` directory itself) is satisfied by
  // definition — the Tenant exists before its rows do.
  let edges = foreignKeys.filter(fk => remaining.has(fk.child) && remaining.has(fk.parent));

  const order: string[] = [];
  const deferred: Record<string, string[]> = {};
  const unbreakable: string[][] = [];

  const defer = (fk: ForeignKey) => {
    const columns = (deferred[fk.child] ??= []);
    if (!columns.includes(fk.column)) columns.push(fk.column);
  };

  // A self-reference is never satisfiable by ordering, so it is deferred up
  // front and never counted as a dependency — but only if it *can* be deferred.
  // Deferring means writing NULL on the first pass and filling it in on the
  // second, which a NOT NULL column refuses. Today all three self-references in
  // this schema are nullable; a required one added later has to be reported
  // here, where `exportTenant` refuses to write an archive that could not be
  // restored, rather than discovered as a not-null violation halfway through
  // somebody's restore.
  for (const fk of edges) {
    if (fk.child !== fk.parent) continue;
    if (fk.required) unbreakable.push([fk.child]);
    else defer(fk);
  }
  edges = edges.filter(fk => fk.child !== fk.parent);

  while (remaining.size > 0) {
    const blocked = new Set(edges.map(fk => fk.child));
    // Stable output: same schema in, same order out, so a manifest is
    // comparable between two exports.
    const ready = [...remaining].filter(t => !blocked.has(t)).sort();

    if (ready.length > 0) {
      for (const table of ready) {
        order.push(table);
        remaining.delete(table);
      }
      edges = edges.filter(fk => remaining.has(fk.parent));
      continue;
    }

    // Everything left depends on something else left. Break the knot on one
    // nullable edge that sits on a cycle, then look again; if no such edge
    // exists, the schema cannot be restored in any order and saying so is the
    // only honest answer. One edge, and only a cycle's: tables that merely
    // wait on the cycle (everything written after `pt_sessions`, say) are
    // also still "remaining" here, and deferring their nullable references
    // too would mean clearing and refilling those columns on every row of
    // some of the largest tables for a cycle that is none of their business.
    const knot = [...remaining].sort();
    const breakable = edges
      .filter(fk => !fk.required && reaches(edges, fk.parent, fk.child))
      .sort((a, b) => (a.child < b.child ? -1 : a.child > b.child ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
    const [cut] = breakable;
    if (!cut) {
      unbreakable.push(knot);
      for (const table of knot) {
        order.push(table);
        remaining.delete(table);
      }
      edges = [];
      break;
    }
    defer(cut);
    edges = edges.filter(fk => fk !== cut);
  }

  return { order, deferred, unbreakable };
}

/** Whether `from` depends, directly or through other tables, on `to`. */
function reaches(edges: readonly ForeignKey[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const table = stack.pop()!;
    if (table === to) return true;
    if (seen.has(table)) continue;
    seen.add(table);
    for (const fk of edges) if (fk.child === table) stack.push(fk.parent);
  }
  return false;
}
