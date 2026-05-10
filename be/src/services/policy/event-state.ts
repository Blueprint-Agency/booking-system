/**
 * Pure function: computes event state at read time from (starts_at, ends_at, lifecycle, now).
 * Spec §4e: never persisted.
 */
export type EventState = 'scheduled' | 'ongoing' | 'completed' | 'cancelled'

export interface EventStateInput {
  startsAt: Date
  endsAt: Date
  lifecycle: 'active' | 'cancelled'
  now: Date
}

export function computeEventState({ startsAt, endsAt, lifecycle, now }: EventStateInput): EventState {
  if (lifecycle === 'cancelled') return 'cancelled'
  if (now < startsAt) return 'scheduled'
  if (now <= endsAt) return 'ongoing'
  return 'completed'
}
