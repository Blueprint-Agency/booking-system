import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { TestApp } from './harness'

/** Which write the abort lands on. */
export interface AbortOnceAt {
  table: string
  event: 'INSERT' | 'UPDATE' | 'DELETE'
  /**
   * A trigger `WHEN` condition over `OLD` and `NEW`, to pick the rows it
   * watches: `OLD.id = '…'`. Without it every row of the table is watched.
   */
  rowWhen?: string
  /**
   * A PL/pgSQL condition over `OLD`, `NEW` and `TG_OP`, for the writes among
   * those rows that count: `NEW.state = 'cancelled'`. Without it every write does.
   */
  raiseIf?: string
}

/**
 * Run `run` with the first matching write aborted by Postgres's deadlock
 * code (`40P01`), as if the transaction had lost a deadlock at that statement,
 * and the writes after it left alone. For a test that needs the abort to hit
 * one chosen statement on every run, which a real race cannot promise.
 *
 * A sequence counts the matches, because the abort rolls back anything the
 * trigger itself writes. The trigger, the function and the sequence are
 * dropped when `run` is done, whether or not it threw.
 *
 * `reached` is how many matching writes were attempted: 2 means the first was
 * aborted and the second went through, 1 that the first was aborted and
 * nothing tried again, 0 that no matching write was ever attempted.
 */
export async function abortOnce<T>(
  db: TestApp['db'],
  at: AbortOnceAt,
  run: () => Promise<T>,
): Promise<{ result: T; reached: number }> {
  const fault = `abort_once_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  await db.execute(sql.raw(`CREATE SEQUENCE ${fault}_seq`))
  try {
    await db.execute(
      sql.raw(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          IF ${at.raiseIf ?? 'true'} AND nextval('${fault}_seq') = 1 THEN
            RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
          END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END $$`),
    )
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${fault} BEFORE ${at.event} ON ${at.table} FOR EACH ROW ${
          at.rowWhen ? `WHEN (${at.rowWhen}) ` : ''
        }EXECUTE FUNCTION ${fault}()`,
      ),
    )
    const result = await run()
    const [counted] = await db.execute<{ n: string }>(
      sql.raw(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text AS n FROM ${fault}_seq`),
    )
    return { result, reached: Number(counted!.n) }
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${fault} ON ${at.table}`))
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fault}()`))
    await db.execute(sql.raw(`DROP SEQUENCE IF EXISTS ${fault}_seq`))
  }
}
