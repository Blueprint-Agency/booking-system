"use client";
import { useParams, useRouter } from "next/navigation";
import { workshops } from "@/data";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";

export default function EditWorkshopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const initial = workshops.find((w) => w.id === id) ?? null;
  if (!initial) return <div className="p-6 text-sm text-muted">Workshop not found.</div>;
  return (
    <WorkshopEditor
      initial={initial}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}
