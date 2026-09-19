/** All money math in integer cents — float arithmetic drifts on edge cases. */
export const toCents = (sgd: string | number): number => Math.round(Number(sgd) * 100)

/** Cents back to the `numeric(10,2)` string the database stores. The inverse of `toCents`. */
export const toSgd = (cents: number): string => (cents / 100).toFixed(2)
