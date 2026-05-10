import type { Response } from 'express'

type SSEClient = { userId: string; res: Response }

const clients: SSEClient[] = []

export function addSSEClient(userId: string, res: Response) {}

export function removeSSEClient(userId: string) {}

export function emitToAdmins(event: string, data: unknown) {}
