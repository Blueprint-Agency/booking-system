import type { Workshop, Capacity } from "@/types";

// Mock "today" anchor: 2026-05-10 (matches user's current date)

const cap = (online: number, buffer = 2, waitlist = 0): Capacity => ({
  waitlist,
  onlineBooking: online,
  buffer,
});

export const workshops: Workshop[] = [
  {
    id: "wsp-1",
    name: "Ashtanga Immersion Weekend",
    descriptionHtml:
      "<p>Two days of dedicated practice with senior teacher Ravi Kumar. Mornings cover the full primary series; afternoons explore pranayama and inversions.</p><p>Suitable for intermediate and above. Bring your own mat and a small towel.</p>",
    locationId: "loc-riverside",
    mainInstructorId: "ins-ravi",
    supportingInstructorIds: ["ins-priya"],
    instructorIds: ["ins-ravi", "ins-priya"],
    days: [
      { id: "wd-1-sat", date: "2026-05-23", startTime: "09:00", endTime: "17:00", roomId: "room-bt-a", capacity: cap(24, 1) },
      { id: "wd-1-sun", date: "2026-05-24", startTime: "09:00", endTime: "17:00", roomId: "room-bt-a", capacity: cap(24, 1) },
    ],
    tiers: [
      {
        id: "wtier-1a",
        workshopId: "wsp-1",
        name: "Full Weekend",
        description: "Both days, full programme.",
        dayIds: ["wd-1-sat", "wd-1-sun"],
        priceSgd: 380,
        earlyBirdPriceSgd: 320,
        earlyBirdCutoffAt: "2026-05-12T16:00:00.000Z",
      },
      {
        id: "wtier-1b",
        workshopId: "wsp-1",
        name: "Saturday Only",
        description: "Saturday morning + afternoon sessions.",
        dayIds: ["wd-1-sat"],
        priceSgd: 220,
        earlyBirdPriceSgd: 180,
        earlyBirdCutoffAt: "2026-05-12T16:00:00.000Z",
      },
    ],
    promotions: [],
    lifecycle: "active",
    cancelledAt: null,
    cancelledByStaffId: null,
  },
  {
    id: "wsp-2",
    name: "Yin & Sound Healing",
    descriptionHtml:
      "<p>An evening of long-held yin postures paired with crystal singing bowls and Tibetan chimes. Mei Lin guides the asana; sound therapist Naomi Khoo takes the second hour.</p>",
    locationId: "loc-eastgate",
    mainInstructorId: "ins-mei",
    supportingInstructorIds: [],
    instructorIds: ["ins-mei"],
    days: [
      { id: "wd-2-day", date: "2026-06-07", startTime: "19:00", endTime: "21:30", roomId: "room-op-hall", capacity: cap(20) },
    ],
    tiers: [
      {
        id: "wtier-2a",
        workshopId: "wsp-2",
        name: "Single Ticket",
        description: "90-min yin practice + 60-min sound bath.",
        dayIds: ["wd-2-day"],
        priceSgd: 80,
        earlyBirdPriceSgd: null,
        earlyBirdCutoffAt: null,
      },
    ],
    promotions: [],
    lifecycle: "active",
    cancelledAt: null,
    cancelledByStaffId: null,
  },
  {
    id: "wsp-3",
    name: "Weekend Aerial Intensive",
    descriptionHtml:
      "<p>Three consecutive Saturdays building from foundational hammock work to full inversions and short choreographies. Open to intermediate practitioners.</p>",
    locationId: "loc-riverside",
    mainInstructorId: "ins-jay",
    supportingInstructorIds: [],
    instructorIds: ["ins-jay"],
    days: [
      { id: "wd-3-day1", date: "2026-06-13", startTime: "14:00", endTime: "17:00", roomId: "room-bt-a", capacity: cap(12, 1, 2) },
      { id: "wd-3-day2", date: "2026-06-20", startTime: "14:00", endTime: "17:00", roomId: "room-bt-a", capacity: cap(12, 1, 2) },
      { id: "wd-3-day3", date: "2026-06-27", startTime: "14:00", endTime: "17:00", roomId: "room-bt-a", capacity: cap(12, 1, 2) },
    ],
    tiers: [
      { id: "wtier-3-d1", workshopId: "wsp-3", name: "Day 1 Pass", description: "Single-day pass for Day 1.", dayIds: ["wd-3-day1"], priceSgd: 120, earlyBirdPriceSgd: null, earlyBirdCutoffAt: null },
      { id: "wtier-3-d2", workshopId: "wsp-3", name: "Day 2 Pass", description: "Single-day pass for Day 2.", dayIds: ["wd-3-day2"], priceSgd: 120, earlyBirdPriceSgd: null, earlyBirdCutoffAt: null },
      { id: "wtier-3-d3", workshopId: "wsp-3", name: "Day 3 Pass", description: "Single-day pass for Day 3.", dayIds: ["wd-3-day3"], priceSgd: 120, earlyBirdPriceSgd: null, earlyBirdCutoffAt: null },
      {
        id: "wtier-3-full",
        workshopId: "wsp-3",
        name: "Full Event Pass",
        description: "All three Saturdays — best value.",
        dayIds: ["wd-3-day1", "wd-3-day2", "wd-3-day3"],
        priceSgd: 300,
        earlyBirdPriceSgd: 260,
        earlyBirdCutoffAt: "2026-05-30T16:00:00.000Z",
      },
    ],
    promotions: [],
    lifecycle: "active",
    cancelledAt: null,
    cancelledByStaffId: null,
  },
];
