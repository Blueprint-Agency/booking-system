"use client";
import { PageHeader } from "@/components/ui";
import { ProfilePictureField } from "@/components/profile/profile-picture-field";
import { useWorkspace } from "@/lib/workspace-context";

export default function AdminProfilePage() {
  const { currentStaff } = useWorkspace();
  if (!currentStaff) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My profile" description="Your account, and the picture everyone sees." />

      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Account</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted">Name</dt>
              <dd className="break-words text-sm text-ink">{currentStaff.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Email</dt>
              <dd className="break-all text-sm text-ink">{currentStaff.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Role</dt>
              <dd className="text-sm capitalize text-ink">{currentStaff.role}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Your name and other details are edited from the Staff page.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Picture</h2>
          <ProfilePictureField />
        </section>
      </div>
    </div>
  );
}
