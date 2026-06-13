"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";

interface InstructorProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  bio: string | null;
  phone: string | null;
  photo_r2_key: string | null;
}

export default function InstructorProfilePage() {
  const { api } = useWorkspace();
  const [profile, setProfile] = useState<InstructorProfile | null>(null);
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<InstructorProfile>("/portal/instructor/profile");
      setProfile(res);
      setBio(res.bio ?? "");
      setPhone(res.phone ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    try {
      const res = await api.patch<InstructorProfile>("/portal/instructor/profile", {
        bio: bio.trim() === "" ? null : bio.trim(),
        phone: phone.trim() === "" ? null : phone.trim(),
      });
      setProfile(res);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? `Couldn't save (HTTP ${err.status})` : "Couldn't save",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="My profile"
        description="Your account details and the bio members can see."
      />

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
          Failed to load profile: {error}
        </div>
      )}

      {loading || !profile ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-4 text-sm font-semibold text-ink">Account</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Name</dt>
                <dd className="text-sm text-ink">{profile.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Email</dt>
                <dd className="text-sm text-ink">{profile.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Role</dt>
                <dd className="text-sm capitalize text-ink">{profile.role}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Status</dt>
                <dd className="text-sm capitalize text-ink">{profile.status}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Manage your name, email, and password from the account menu (top
              right).
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-4 text-sm font-semibold text-ink">Public profile</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short intro members see next to your classes."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional contact number"
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save profile
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
