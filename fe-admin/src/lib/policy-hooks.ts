"use client";

import { useAdminState } from "@/lib/admin-state";
import {
  CLASS_CANCELLATION_HOURS,
  PRIVATE_SESSION_CANCELLATION_HOURS,
  PRIVATE_CONFIRMATION_SLA_HOURS,
  LAST_MINUTE_THRESHOLD,
} from "./policy";

export function useClassCancellationHours(): number {
  return useAdminState((s) => s.policy?.classCancelHours ?? CLASS_CANCELLATION_HOURS);
}

export function usePrivateCancellationHours(): number {
  return useAdminState((s) => s.policy?.privateCancelHours ?? PRIVATE_SESSION_CANCELLATION_HOURS);
}

export function usePrivateSlaHours(): number {
  return useAdminState((s) => s.policy?.privateSlaHours ?? PRIVATE_CONFIRMATION_SLA_HOURS);
}

export function useLastMinuteThreshold(): number {
  return useAdminState((s) => s.policy?.lastMinuteThreshold ?? LAST_MINUTE_THRESHOLD);
}
