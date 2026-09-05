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

export type TableOrder = {
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
 * dependencies but tables remain, the graph has a cycle. Rather than fail, the
 * nullable edges in that cycle are removed and recorded as deferred — which is
 * exactly what a self-reference is, a cycle of length one.
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
  // front and never counted as a dependency.
  for (const fk of edges) if (fk.child === fk.parent) defer(fk);
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

    // Everything left depends on something else left. Break the knot on its
    // nullable edges; if it has none, the schema cannot be restored in any
    // order and saying so is the only honest answer.
    const knot = [...remaining].sort();
    const breakable = edges.filter(fk => !fk.required);
    if (breakable.length === 0) {
      unbreakable.push(knot);
      for (const table of knot) {
        order.push(table);
        remaining.delete(table);
      }
      edges = [];
      break;
    }
    for (const fk of breakable) defer(fk);
    edges = edges.filter(fk => fk.required);
  }

  return { order, deferred, unbreakable };
}
