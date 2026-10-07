/** All money math in integer cents — float arithmetic drifts on edge cases. */
export const toCents = (sgd: string | number): number => Math.round(Number(sgd) * 100)

/** Cents back to the `numeric(10,2)` string the database stores. The inverse of `toCents`. */
export const toSgd = (cents: number): string => (cents / 100).toFixed(2)

/**
 * Cents as a member reads them, in a sentence or an email: "S$150.00". The one
 * form the studio prints money in to members (refund notices, part payments,
 * purchase receipts). Every studio sells in Singapore dollars: the money
 * columns are `*_sgd` and checkout charges `sgd`.
 */
export const sgdText = (cents: number): string => `S$${toSgd(cents)}`
