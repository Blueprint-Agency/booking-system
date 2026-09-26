/**
 * What unticking a member's attendance asks first, on the class roster and on
 * the check-in desk alike (admin-restructure §11). Unticking only removes the
 * check-in; the credit it spent stays spent until the booking is cancelled.
 */
export function untickConfirmCopy(name: string) {
  return {
    title: `Unmark ${name} as attended?`,
    body: "Their check-in is removed. The credit stays spent — to return it, cancel the booking afterwards.",
    keep: "Keep attended",
    confirm: "Unmark",
  };
}
