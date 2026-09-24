import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readMemberList, readSales } from '../transform/readers'
import { plannedFiles, profileReports, reportsDir } from './plan'

/**
 * Big Spenders lists its clients biggest first and stops at a cap
 * (`BIG_SPENDERS_CAP`). A client past the cap is not in the file at all, so
 * every sale of theirs would be missing from the studio's history, and nothing
 * would say so. The cap cannot simply be huge (the Summary view errors), so
 * after a cutover download it is checked against the Members instead.
 */

export type CapCheck = { level: 'ok' | 'warn' | 'refuse'; message: string }

/** Near enough to the cap to say so: a busy month could take the studio past it. */
const NEAR = 0.9

export function checkSalesCap(input: { cap: number; members: number; clientsListed: number }): CapCheck {
  const { cap, members, clientsListed } = input
  if (clientsListed >= cap) {
    return { level: 'refuse', message: `Big Spenders lists ${clientsListed} clients, which is its cap: the file stopped there, and anyone past it lost every sale. Raise BIG_SPENDERS_CAP and download again.` }
  }
  if (members >= cap) {
    return { level: 'refuse', message: `The studio has ${members} members and Big Spenders lists at most ${cap}: anyone past the cap would lose every sale. Raise BIG_SPENDERS_CAP and download again.` }
  }
  if (members >= cap * NEAR) {
    return { level: 'warn', message: `The studio has ${members} members, near Big Spenders' cap of ${cap}. Nobody was cut off this time; raise BIG_SPENDERS_CAP before the studio outgrows it.` }
  }
  return { level: 'ok', message: `Big Spenders cap ${cap}: ${members} members, ${clientsListed} clients with sales.` }
}

/** The check, on a finished cutover download: its Mailing List and its Big Spenders file. */
export function checkExportSalesCap(exportDir: string, cap: number): CapCheck {
  const planned = plannedFiles(profileReports('cutover'))
  const fileOf = (kind: string) => {
    const f = planned.find(p => p.report.kind === kind)!
    return path.join(reportsDir(exportDir), f.folder, f.file)
  }
  const members = readMemberList(readFileSync(fileOf('members'), 'utf8')).length
  const sales = readSales(readFileSync(fileOf('sales'), 'utf8'))
  const clientsListed = new Set(sales.flatMap(s => (s.clientId ? [s.clientId] : []))).size
  return checkSalesCap({ cap, members, clientsListed })
}
