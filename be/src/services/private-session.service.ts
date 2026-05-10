export async function submitRequest(
  clientId: string,
  instructorId: string,
  requestedAt: Date,
  locationId: string,
  message?: string,
) {}

export async function respondToRequest(
  requestId: string,
  actorId: string,
  approved: boolean,
  note?: string,
) {}

export async function expireStaleSessions() {}

export async function escalateSLA() {}
