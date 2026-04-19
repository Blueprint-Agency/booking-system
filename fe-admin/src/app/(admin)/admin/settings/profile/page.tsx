"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAdminState } from "@/lib/admin-state";
import { Button, Input, Label } from "@/components/ui";
import { updateAdminProfile } from "@/lib/mutations/settings";

export default function ProfileSettingsPage() {
  const me = useAdminState((s) =>
    s.auth.userId ? s.adminUsers.find((u) => u.id === s.auth.userId) : undefined,
  );
  const [name, setName] = useState(me?.name ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [avatarUrl, setAvatarUrl] = useState(me?.avatarUrl ?? "");

  if (!me) {
    return <p className="text-sm text-muted">Sign in to edit your profile.</p>;
  }

  const save = () => {
    updateAdminProfile({ name, email, avatarUrl });
    toast.success("Profile updated");
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:max-w-xl">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>Email</Label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label>Avatar URL</Label>
        <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={save}>
          Save profile
        </Button>
      </div>
    </div>
  );
}
