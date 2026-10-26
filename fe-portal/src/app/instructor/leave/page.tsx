"use client";
import { Suspense } from "react";
import { MyLeave } from "@/components/leave/my-leave";

/** An instructor's own leave — the same page an admin has at /admin/my-leave. */
export default function InstructorLeavePage() {
  // MyLeave reads `?request=` (a link from the bell), which needs a Suspense boundary.
  return (
    <Suspense>
      <MyLeave />
    </Suspense>
  );
}
