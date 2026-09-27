/**
 * What a class-booking refusal from package selection tells the member. One
 * place, because booking and joining a waitlist hit the same selection
 * (`be/src/services/packages/selection.ts`) and must say the same thing.
 */

/** `location_not_covered`: the member's plan is for the other studio. */
export function notCoveredCopy(planLocationName: string | null): string {
  return planLocationName ? `Your plan covers ${planLocationName} only.` : "Your plan doesn't cover this studio.";
}

/**
 * `plan_expires_before_class`. Not a coverage problem: the package covers this
 * studio but runs out first. Several packages may run at once, so there is no
 * waiting for it to end: another package can be picked on the Book sheet.
 */
export function planRunsOutCopy(): string {
  return "Your current package runs out before this class starts, so it can't cover it.";
}

/**
 * `not_accepted`: the class's Package rule does not take the package — the one
 * picked, or (joining a waitlist, where none is picked) every one the member
 * holds. Nothing about the package can change that, so the way on is the
 * class detail, which names the packages it does take.
 */
export function notAcceptedCopy(): string {
  return "Your package isn't accepted for this class. Tap the class to see which packages are.";
}
