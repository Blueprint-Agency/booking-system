import type { PgTable } from 'drizzle-orm/pg-core'
import type * as schema from './schema'
import type { ClassTypesTableName } from './schema/catalog'

type IsAny<T> = 0 extends 1 & T ? true : false

type NamesOf<Module> = {
  [Export in keyof Module]: IsAny<Module[Export]> extends true
    ? never
    : Module[Export] extends PgTable
      ? Module[Export]['_']['name']
      : never
}[keyof Module]

/**
 * The name of every table the schema declares, read off the schema itself, so
 * renaming or dropping a table breaks each place that still names it at
 * compile time. Types only: nothing here runs.
 *
 * `classTypes` is exported typed `any`, which has no name to read, so its name
 * comes from the typed table behind it.
 */
export type TableName = NamesOf<typeof schema> | ClassTypesTableName
