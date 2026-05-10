export async function send(
  eventType: string,
  recipientId: string,
  variables: Record<string, unknown>,
  triggeredBy?: string,
) {}

export async function resendNotification(
  notificationSendId: string,
  actorId: string,
  reason: string,
) {}
