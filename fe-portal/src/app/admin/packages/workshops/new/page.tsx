"use client";
import { useRouter } from "next/navigation";
import { WorkshopEditor } from "@/components/workshops/workshop-editor";

export default function NewWorkshopPage() {
  const router = useRouter();
  return (
    <WorkshopEditor
      initial={null}
      onCancel={() => router.push("/admin/packages/workshops")}
      onSave={() => router.push("/admin/packages/workshops")}
    />
  );
}
