"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mail, Archive, RotateCcw } from "lucide-react";
import { Button, Input, Label, Avatar, Badge, PageHeader } from "@/components/ui";
import { classTypes } from "@/data";
import type { Instructor } from "@/types";

export function InstructorForm({
  initial,
  isNew = false,
}: {
  initial?: Instructor;
  isNew?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [eligible, setEligible] = useState<string[]>(initial?.eligibleClassTypeIds ?? []);
  const isArchived = !!initial?.archivedAt;

  function toggleType(id: string) {
    setEligible((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isNew) {
      // Mock: in production, save + auto-fire instructor invite (§15b)
      alert(
        `Instructor profile saved (mock).\n\nAuto-fired instructor invite email to ${email}.`
      );
    } else {
      alert("Instructor updated (mock).");
    }
    router.push("/admin/instructors");
  }

  function handleArchive() {
    if (!initial) return;
    alert(
      isArchived
        ? "Instructor restored (mock)."
        : "Instructor archived (mock). Active sessions force-logged-out."
    );
    router.push("/admin/instructors");
  }

  function handleResendInvite() {
    if (!initial) return;
    alert(`Invite email re-sent to ${initial.email} (mock).`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/instructors"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All instructors
      </Link>
      <PageHeader
        title={isNew ? "New instructor" : initial?.name ?? "Instructor"}
        description={
          isNew
            ? "Saving the profile auto-sends an invite email. The instructor can be assigned to classes immediately, even before accepting."
            : "All fields are editable. Email changes do not re-issue the original invite."
        }
        actions={
          !isNew && initial ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleResendInvite}>
                <Mail className="h-3.5 w-3.5" /> Resend invite
              </Button>
              <Button variant="secondary" size="sm" onClick={handleArchive}>
                {isArchived ? (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </>
                ) : (
                  <>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </>
                )}
              </Button>
            </div>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-1">
          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="flex flex-col items-center gap-3">
              <Avatar name={name || "?"} size={96} />
              <Button type="button" variant="secondary" size="sm" disabled>
                Upload photo (mock)
              </Button>
            </div>
            {!isNew && initial && (
              <div className="mt-5 space-y-2 text-xs text-muted">
                <div>
                  Account status:{" "}
                  <Badge tone={isArchived ? "neutral" : "sage"}>
                    {isArchived ? "Archived" : "Active"}
                  </Badge>
                </div>
                <div>
                  Invite:{" "}
                  <Badge tone="sage">Accepted</Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 md:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ins-name">Name</Label>
                <Input
                  id="ins-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ins-email">Email</Label>
                <Input
                  id="ins-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ins-phone">Phone</Label>
                <Input
                  id="ins-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+65 …"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ins-bio">Bio</Label>
                <textarea
                  id="ins-bio"
                  className="flex min-h-[100px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Lineage, certifications, teaching style…"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-ink">Eligible class types</h3>
              <p className="mt-0.5 text-xs text-muted">
                Determines which class types this instructor can be assigned to.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {classTypes
                .filter((c) => !c.archivedAt)
                .map((c) => {
                  const on = eligible.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleType(c.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "bg-accent text-white"
                          : "bg-paper text-muted hover:bg-warm hover:text-ink"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Link href="/admin/instructors">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit">{isNew ? "Save & send invite" : "Save changes"}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
