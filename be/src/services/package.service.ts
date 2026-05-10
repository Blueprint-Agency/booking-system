export async function purchasePackage(clientId: string, packageId: string) {}

export async function issuePackage(clientId: string, packageId: string, actorId: string, reason?: string) {}

export async function adjustCredits(clientId: string, delta: number, actorId: string, reason: string) {}

export async function adjustSessions(clientId: string, delta: number, actorId: string, reason: string) {}

export async function resolvePackageMutex(
  clientId: string,
  newPackageId: string,
  resolution: 'replace' | 'queue',
  actorId: string,
) {}
