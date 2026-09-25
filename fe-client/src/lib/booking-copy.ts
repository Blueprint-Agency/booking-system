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
 * studio but runs out first. `creditsCanStart` is whether credits could step
 * in now; when they cannot, the member waits for the next package to start.
 */
export function planRunsOutCopy(creditsCanStart: boolean): string {
  return (
    "Your current package runs out before this class starts, so it can't cover it." +
    (creditsCanStart ? "" : " Try again once it has ended and your next package is running.")
  );
}
