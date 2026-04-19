"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { BroadcastComposer } from "@/components/domain/notifications/broadcast-composer";

export default function NewBroadcastPage() {
  return (
    <>
      <div className="mb-3 text-xs text-muted">
        <Link href="/admin/notifications" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
      </div>
      <PageHeader title="New broadcast" description="Compose, pick audience, send or schedule." />
      <div className="mt-6">
        <BroadcastComposer />
      </div>
    </>
  );
}
