"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mail, Archive, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, Avatar, Badge, PageHeader } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import type { Instructor } from "@/types";

export function InstructorForm({
  initial,
  isNew = false,
}: {
  initial?: Instructor;
  isNew?: boolean;
}) {
  const router = useRouter();
  const { api } = useWorkspace();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const isArchived = !!initial?.archivedAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.post("/portal/admin/instructors", {
          email: email.trim(),
          name: name.trim(),
          bio: bio.trim() || null,
          phone: phone.trim() || null,
        });
        toast.success("Instructor created. (Invite email sending lands in v1.)");
      } else if (initial) {
        await api.patch(`/portal/admin/instructors/${initial.id}`, {
          name: name.trim(),
          bio: bio.trim() || null,
          phone: phone.trim() || null,
        });
        toast.success("Instructor updated.");
      }
      router.push("/admin/instructors");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Save failed (HTTP ${err.status}).` : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!initial || !api) return;
    if (isArchived) {
      toast.info("Restore is a v1 feature.");
      return;
    }
    try {
      await api.post(`/portal/admin/instructors/${initial.id}/archive`);
      toast.success("Instructor archived.");
      router.push("/admin/instructors");
    } catch (err) {
      toast.error(err instanceof ApiError ? `Archive failed (HTTP ${err.status}).` : "Archive failed.");
    }
  }

  function handleResendInvite() {
    // Per v0 scope: leave the affordance, wire to a no-op + informational toast.
    toast.info("Resend invite is a v1 feature.");
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
            ? "Saving creates the staff record. In v0 the invitation email is not yet auto-sent — that ships in v1."
            : "All fields are editable. Email is immutable after invite."
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
                Upload photo (v1)
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
                  disabled={!isNew}
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

          <div className="flex justify-end gap-2">
            <Link href="/admin/instructors">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : isNew ? (
                "Save instructor"
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
