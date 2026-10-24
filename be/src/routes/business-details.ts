import { z } from 'zod'
import type { BusinessDetailsInput, BusinessDetailsView } from '../services/tenants/business-details'

/**
 * A studio's Business details on the wire (#391, #398), as the portal's
 * Business details page and the super portal's create form both send them.
 * Here, beside `receipt-views.ts`, rather than under either audience's routes,
 * so neither imports the other's. Shape only: that a Business name is required,
 * what a prefix may be and how long each detail may run is
 * `cleanBusinessDetails`'s to say, so both surfaces refuse the same things in
 * the same words.
 */
const detail = z.string().max(5000).nullable().optional()

export const businessDetailsBody = z.object({
  business_name: detail,
  // Absent leaves the studio's Display name as it is; null or blank is refused.
  display_name: detail,
  prefix: detail,
  registration_number: detail,
  address: detail,
  footer: detail,
})

type BusinessDetailsBody = z.infer<typeof businessDetailsBody>

export const businessDetailsInput = (body: BusinessDetailsBody): BusinessDetailsInput => ({
  businessName: body.business_name,
  displayName: body.display_name,
  prefix: body.prefix,
  registrationNumber: body.registration_number,
  address: body.address,
  footer: body.footer,
})

export const serializeBusinessDetails = (view: BusinessDetailsView) => ({
  business_details: {
    business_name: view.details.businessName,
    display_name: view.details.displayName,
    prefix: view.details.prefix,
    registration_number: view.details.registrationNumber,
    address: view.details.address,
    footer: view.details.footer,
  },
  next_number: view.nextNumber,
  next_sequence: view.nextSequence,
})
