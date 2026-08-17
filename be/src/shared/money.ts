/** All money math in integer cents — float arithmetic drifts on edge cases. */
export const toCents = (sgd: string | number): number => Math.round(Number(sgd) * 100)
