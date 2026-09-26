/**
 * A browser treats a wheel or trackpad scroll over a focused `type="number"`
 * field as presses of its stepper, so scrolling the page past a pay field set to
 * 200 with a 0.01 step quietly turned it into 199.8. Blurring on the wheel stops
 * that and lets the page scroll instead; the stepper arrows and the keyboard
 * arrows are untouched. Wired once, into the shared `Input`.
 */
export function blurNumberOnWheel(field: { type: string; blur: () => void }): void {
  if (field.type === "number") field.blur();
}
