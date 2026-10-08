import { z } from 'zod'
import type { ReceiptDetailsInput, ReceiptDetailsView } from '../../services/receipts/details'

/**
 * A studio's receipt details on the wire (#391), as the portal's studio
 * settings and the super portal's create form both send them. Shape only:
 * what a prefix may be and how long each detail may run is
 * `cleanReceiptDetails`'s to say, so both surfaces refuse the same things in
 * the same words.
 */
const detail = z.string().max(5000).nullable().optional()

export const receiptDetailsBody = z.object({
  prefix: detail,
  legal_name: detail,
  registration_number: detail,
  address: detail,
  footer: detail,
})

export type ReceiptDetailsBody = z.infer<typeof receiptDetailsBody>

export const receiptDetailsInput = (body: ReceiptDetailsBody): ReceiptDetailsInput => ({
  prefix: body.prefix,
  legalName: body.legal_name,
  registrationNumber: body.registration_number,
  address: body.address,
  footer: body.footer,
})

export const serializeReceiptDetails = (view: ReceiptDetailsView) => ({
  receipt_details: {
    prefix: view.details.prefix,
    legal_name: view.details.legalName,
    registration_number: view.details.registrationNumber,
    address: view.details.address,
    footer: view.details.footer,
  },
  next_number: view.nextNumber,
  next_sequence: view.nextSequence,
})
