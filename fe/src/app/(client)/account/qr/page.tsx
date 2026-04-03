"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { formatDate, formatTime, cn } from "@/lib/utils";
import type { Booking, Session } from "@/types";
import bookingsData from "@/data/bookings.json";
import sessionsData from "@/data/sessions.json";

const CLIENT_ID = "cli-1";
const MOCK_TODAY = "2026-04-03";

const allBookings = bookingsData as Booking[];
const allSessions = sessionsData as Session[];

// Upcoming confirmed bookings for this client
const upcomingBookings = allBookings
  .filter((b) => {
    if (b.clientId !== CLIENT_ID) return false;
    if (b.status !== "confirmed") return false;
    const session = allSessions.find((s) => s.id === b.sessionId);
    if (!session || session.status === "cancelled") return false;
    return session.date >= MOCK_TODAY;
  })
  .sort((a, b) => {
    const sa = allSessions.find((s) => s.id === a.sessionId);
    const sb = allSessions.find((s) => s.id === b.sessionId);
    if (!sa || !sb) return 0;
    return sa.date.localeCompare(sb.date) || sa.time.localeCompare(sb.time);
  });

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function MyQRCode() {
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    upcomingBookings[0]?.id ?? null
  );

  const selectedBooking = upcomingBookings.find((b) => b.id === selectedBookingId);
  const selectedSession = selectedBooking
    ? allSessions.find((s) => s.id === selectedBooking.sessionId)
    : null;

  // QR value encodes studio prefix + booking ID for unique per-session code
  const qrValue = selectedBooking
    ? `YS-BOOKING-${selectedBooking.id.toUpperCase()}-${selectedBooking.sessionId.toUpperCase()}`
    : "YS-NO-BOOKING";

  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-2"
      >
        My QR Code
      </motion.h2>
      <motion.p
        initial="hidden"
        animate="visible"
        custom={1}
        variants={fadeUp}
        className="text-sm text-muted mb-6"
      >
        Each booked session has a unique QR code. Select a session below, then show the QR at the front desk for check-in.
      </motion.p>

      {upcomingBookings.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm">
          No upcoming bookings. Book a class to get your session QR code.
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Session selector */}
          <motion.div
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="lg:w-72 space-y-2"
          >
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Upcoming Sessions</p>
            {upcomingBookings.map((booking) => {
              const session = allSessions.find((s) => s.id === booking.sessionId);
              if (!session) return null;
              const isSelected = booking.id === selectedBookingId;
              return (
                <button
                  key={booking.id}
                  onClick={() => setSelectedBookingId(booking.id)}
                  className={cn(
                    "w-full text-left px-4 py-3.5 rounded-lg border transition-all duration-200",
                    isSelected
                      ? "bg-accent-glow/30 border-accent text-ink"
                      : "bg-card border-border text-muted hover:text-ink hover:bg-warm hover:border-ink/10"
                  )}
                >
                  <p className={cn("text-sm font-medium mb-0.5", isSelected ? "text-ink" : "text-ink")}>
                    {session.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(session.date)} · {formatTime(session.time)}
                  </p>
                </button>
              );
            })}
          </motion.div>

          {/* QR display */}
          <motion.div
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="flex-1"
          >
            {selectedSession && (
              <div className="bg-card border border-border rounded-xl p-8 text-center max-w-sm">
                {/* QR Code */}
                <div className="inline-flex p-5 bg-white rounded-xl shadow-soft mb-5">
                  <QRCodeSVG
                    value={qrValue}
                    size={180}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#1a1a2e"
                  />
                </div>

                {/* Session info */}
                <div className="mb-4 space-y-1">
                  <p className="font-serif text-lg text-ink">{selectedSession.name}</p>
                  <p className="text-sm text-muted">
                    {formatDate(selectedSession.date)} · {formatTime(selectedSession.time)} · {selectedSession.duration} min
                  </p>
                </div>

                {/* Booking reference */}
                <div className="bg-warm rounded-lg px-4 py-2.5 mb-4">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-0.5">Booking Reference</p>
                  <p className="text-xs font-mono text-ink">{qrValue}</p>
                </div>

                <p className="text-xs text-muted">
                  Show this QR at the front desk · Increase screen brightness for faster scanning
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
