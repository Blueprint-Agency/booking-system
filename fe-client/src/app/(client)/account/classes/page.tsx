import { BookingsPage } from "@/components/account/bookings-page";

export default function AccountClassesPage() {
  return (
    <BookingsPage
      type="class"
      eyebrow="Classes"
      title="Your classes"
      emptyDesc="Browse classes to book your next session."
      browseHref="/classes"
      browseLabel="Browse classes"
    />
  );
}
