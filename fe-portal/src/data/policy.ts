import type { GlobalPolicy, PtBookingConfig } from "@/types";

export const globalPolicy: GlobalPolicy = {
  cancelCapCount: 3,
  cancelCapCycleDays: 30,
  classWindowHours: 12,
  ptWindowHours: 24,
  updatedAt: "2026-04-01T08:00:00.000Z",
};

export const ptBookingConfig: PtBookingConfig = {
  bookInAdvanceDays: 14,
};
