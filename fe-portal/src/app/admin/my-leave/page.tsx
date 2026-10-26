"use client";
import { Suspense } from "react";
import { MyLeave } from "@/components/leave/my-leave";

/** An admin's own leave — the same page an instructor has at /instructor/leave.
 *  Deciding requests, this admin's own included, is the Leave queue's job. */
export default function AdminMyLeavePage() {
  // MyLeave reads `?request=` (a link from the bell), which needs a Suspense boundary.
  return (
    <Suspense>
      <MyLeave />
    </Suspense>
  );
}
