"use client";

import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { ClientProfileForm } from "@/components/domain/clients/client-profile-form";

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const client = useAdminState((s) => s.clients.find((c) => c.id === id));
  if (!client) return null;
  return <ClientProfileForm client={client} />;
}
