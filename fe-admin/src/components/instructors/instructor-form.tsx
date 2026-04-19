"use client";

import { useState } from "react";
import type { Instructor } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upsertInstructor } from "@/lib/mock-state";

export function InstructorForm({
  initial,
  open,
  onClose,
}: {
  initial?: Instructor;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [photo, setPhoto] = useState(initial?.photo ?? "");
  const [specialties, setSpecialties] = useState((initial?.specialties ?? []).join(", "));

  const submit = () => {
    upsertInstructor({
      id: initial?.id,
      name,
      bio,
      photo,
      specialties: specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      availability: initial?.availability,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit instructor" : "New instructor"}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="if-name">Name</Label>
          <Input id="if-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-photo">Photo URL</Label>
          <Input id="if-photo" value={photo} onChange={(e) => setPhoto(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-bio">Bio</Label>
          <Textarea id="if-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="if-spec">Specialties (comma-separated)</Label>
          <Input
            id="if-spec"
            value={specialties}
            onChange={(e) => setSpecialties(e.target.value)}
            placeholder="Vinyasa, Yin, Prenatal"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>Save</Button>
      </div>
    </Modal>
  );
}
