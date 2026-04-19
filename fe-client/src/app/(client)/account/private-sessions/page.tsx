import { BookingsPage } from "@/components/account/bookings-page";

export default function AccountPrivateSessionsPage() {
  return (
    <BookingsPage
      type="private"
      eyebrow="Private Sessions"
      title="Your PT sessions"
      emptyDesc="Book a 1-on-1 or 2-on-1 session with our teachers."
      browseHref="/private-sessions"
      browseLabel="Browse private sessions"
    />
  );
}
