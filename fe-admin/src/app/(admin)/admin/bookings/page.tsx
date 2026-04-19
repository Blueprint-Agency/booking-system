import { PageHeader } from "@/components/ui";
import { BookingsLedger } from "@/components/domain/bookings/bookings-ledger";

export default function BookingsPage() {
  return (
    <>
      <PageHeader title="Bookings" description="Every confirmed, attended, and cancelled booking across the studio." />
      <div className="mt-6">
        <BookingsLedger />
      </div>
    </>
  );
}
