"use client";
import { CheckInDesk } from "@/components/check-in/check-in-desk";

/** The same desk as the admin's, over the sessions this instructor teaches. */
export default function InstructorCheckInPage() {
  return <CheckInDesk audience="instructor" />;
}
