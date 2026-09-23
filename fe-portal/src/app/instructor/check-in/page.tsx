"use client";
import { CheckInDesk } from "@/components/check-in/check-in-desk";

/** The same desk as the admin's, over the sessions this instructor teaches (#192). */
export default function InstructorCheckInPage() {
  return <CheckInDesk audience="instructor" />;
}
