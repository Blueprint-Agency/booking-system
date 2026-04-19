"use client";

import { PageHeader } from "@/components/ui";
import { RequestInbox } from "@/components/domain/private/request-inbox";

export default function PrivateInboxPage() {
  return (
    <>
      <PageHeader
        title="Private session requests"
        description="Inbox sorted by SLA. Accept, decline, or propose an alternative slot."
      />
      <div className="mt-6">
        <RequestInbox />
      </div>
    </>
  );
}
