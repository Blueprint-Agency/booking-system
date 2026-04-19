"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState, setState } from "@/lib/admin-state";
import { useMyInstructorId } from "@/lib/instructor-scope";
import { PageHeader, EmptyState, Input, Textarea, Label, Button } from "@/components/ui";

export default function InstructorProfilePage() {
  const myId = useMyInstructorId();
  const me = useAdminState((s) => s.instructors.find((i) => i.id === myId));
  const [name, setName] = useState(me?.name ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");

  if (!me) {
    return <EmptyState title="No instructor profile" />;
  }

  const save = () => {
    setState((s) => ({
      ...s,
      instructors: s.instructors.map((i) =>
        i.id === me.id ? { ...i, name, bio, email, phone } : i,
      ),
    }));
    toast.success("Profile saved");
  };

  return (
    <>
      <PageHeader title="My profile" description="Update what clients see when they browse instructors." />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:max-w-xl">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Bio</Label>
          <Textarea rows={6} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={save}>
            Save profile
          </Button>
        </div>
      </div>
    </>
  );
}
