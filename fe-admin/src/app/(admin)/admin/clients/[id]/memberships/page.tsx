"use client";

import { useParams } from "next/navigation";
import { MembershipsPanel } from "@/components/domain/clients/memberships-panel";

export default function ClientMembershipsPage() {
  const { id } = useParams<{ id: string }>();
  return <MembershipsPanel clientId={id} />;
}
