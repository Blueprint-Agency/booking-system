"use client";
import { MyLeave } from "@/components/leave/my-leave";

/** An admin's own leave — the same page an instructor has at /instructor/leave.
 *  Deciding requests, this admin's own included, is the Leave queue's job. */
export default function AdminMyLeavePage() {
  return <MyLeave />;
}
