export async function checkRequired(clientId: string): Promise<{ required: boolean }> {
  return { required: false }
}

export async function sign(clientId: string, version: string) {}

export async function resetForClient(clientId: string, actorId: string, reason: string) {}

export async function bulkReset(actorId: string, reason: string) {}

export async function flagExpiredWaivers() {}
