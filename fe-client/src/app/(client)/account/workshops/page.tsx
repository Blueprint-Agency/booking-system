import { BookingsPage } from "@/components/account/bookings-page";

export default function AccountWorkshopsPage() {
  return (
    <BookingsPage
      type="workshop"
      eyebrow="My Workshops"
      title="Your workshops"
      emptyDesc="Explore upcoming workshops to deepen your practice."
      browseHref="/workshops"
      browseLabel="Browse workshops"
    />
  );
}
