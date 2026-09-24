import { and, eq, gt } from 'drizzle-orm'
import { db } from '../../db'
import { classes, ptSessions, workshops, workshopInstructors } from '../../db/schema/schedule'
import { ConflictError } from '../../shared/errors'

/**
 * Refuse to take an instructor out of circulation while they still teach
 * something (admin-restructure §3 Deletion rules): an upcoming or ongoing class
 * they are the main instructor of, a PT session, or a live workshop.
 *
 * One check for every door an archive comes through — the instructor profile
 * and the Staff page — so which button an Admin pressed cannot decide whether
 * members are left booked onto a class whose teacher is locked out (#249).
 * The refusal names what is in the way, so the Admin knows what to reassign.
 */
export async function assertInstructorUnassigned(tenantId: string, staffId: string, now: Date): Promise<void> {
  const futureClasses = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, tenantId),
        eq(classes.mainInstructorId, staffId),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, now),
      ),
    )

  const futurePtSessions = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.tenantId, tenantId),
        eq(ptSessions.instructorId, staffId),
        eq(ptSessions.lifecycle, 'active'),
        gt(ptSessions.endsAt, now),
      ),
    )

  const futureWorkshops = await db
    .select({ id: workshops.id })
    .from(workshops)
    .innerJoin(workshopInstructors, eq(workshopInstructors.workshopId, workshops.id))
    .where(
      and(
        eq(workshops.tenantId, tenantId),
        eq(workshopInstructors.instructorId, staffId),
        eq(workshops.lifecycle, 'active'),
      ),
    )

  if (futureClasses.length || futurePtSessions.length || futureWorkshops.length) {
    throw new ConflictError('instructor_in_use', {
      class_ids: futureClasses.map(r => r.id),
      pt_session_ids: futurePtSessions.map(r => r.id),
      workshop_ids: futureWorkshops.map(r => r.id),
    })
  }
}
