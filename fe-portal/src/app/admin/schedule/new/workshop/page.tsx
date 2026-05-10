"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Save, Plus, Trash2, Image } from "lucide-react";
import { Button, Input, Label, PageHeader, Badge } from "@/components/ui";
import { classTypes, instructors, locations } from "@/data";

interface DraftTier {
  id: string;
  name: string;
  description: string;
  regularPriceSgd: string;
  earlyBirdPriceSgd: string;
  earlyBirdQuota: string;
  earlyBirdCutoffAt: string;
  capacity: string;
}

const blankTier = (): DraftTier => ({
  id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  description: "",
  regularPriceSgd: "",
  earlyBirdPriceSgd: "",
  earlyBirdQuota: "",
  earlyBirdCutoffAt: "",
  capacity: "",
});

export default function NewWorkshopPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [classTypeId, setClassTypeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");
  const [instructorIds, setInstructorIds] = useState<string[]>([]);
  const [tiers, setTiers] = useState<DraftTier[]>([blankTier()]);

  function toggleInstructor(id: string) {
    setInstructorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function updateTier(id: string, patch: Partial<DraftTier>) {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    alert(
      "Workshop created (mock).\n\nVisible on the timetable. Capacity is per tier; once a tier hits capacity it's marked sold out (no waitlist in v1)."
    );
    router.push("/admin/schedule");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      <PageHeader
        title="New workshop"
        description="Workshops are non-refundable and non-cancellable by clients. Only admin can cancel — that triggers an automatic Stripe refund to all attendees."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Workshop info</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="w-name">Name</Label>
              <Input
                id="w-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ashtanga Immersion Weekend"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-ct">Class type</Label>
              <select
                id="w-ct"
                required
                value={classTypeId}
                onChange={(e) => setClassTypeId(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Select…</option>
                {classTypes
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-loc">Location</Label>
              <select
                id="w-loc"
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Select…</option>
                {locations
                  .filter((l) => !l.archivedAt)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="w-desc">Description</Label>
              <textarea
                id="w-desc"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Rich text in production. Plain markdown OK for now."
                className="flex min-h-[120px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-border bg-paper px-4 py-6 text-center text-xs text-muted">
            <Image className="mx-auto mb-2 h-5 w-5" />
            Cover image + additional images
            <div className="mt-1 text-muted">Drag and drop or click to upload (Cloudflare R2 in production)</div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">When</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sd">Start date</Label>
              <Input id="sd" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st">Start time</Label>
              <Input id="st" required type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed">End date</Label>
              <Input id="ed" required type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="et">End time</Label>
              <Input id="et" required type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Instructors</h2>
          <div className="flex flex-wrap gap-2">
            {instructors
              .filter((i) => !i.archivedAt)
              .map((i) => {
                const on = instructorIds.includes(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggleInstructor(i.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      on
                        ? "bg-accent text-white"
                        : "bg-paper text-muted hover:bg-warm hover:text-ink"
                    }`}
                  >
                    {i.name}
                  </button>
                );
              })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Pricing tiers</h2>
              <p className="text-xs text-muted">
                Each tier has its own capacity. Once full, the tier is sold out — no waitlist in v1.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setTiers((p) => [...p, blankTier()])}
            >
              <Plus className="h-3.5 w-3.5" /> Add tier
            </Button>
          </header>
          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div
                key={tier.id}
                className="rounded-lg border border-border bg-paper p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <Badge tone="accent">Tier {idx + 1}</Badge>
                  {tiers.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setTiers((p) => p.filter((t) => t.id !== tier.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      required
                      placeholder="2 Days, 1 Day, …"
                      value={tier.name}
                      onChange={(e) => updateTier(tier.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Capacity</Label>
                    <Input
                      required
                      type="number"
                      min={1}
                      value={tier.capacity}
                      onChange={(e) => updateTier(tier.id, { capacity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Description</Label>
                    <Input
                      placeholder="What's included…"
                      value={tier.description}
                      onChange={(e) => updateTier(tier.id, { description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Regular price (SGD)</Label>
                    <Input
                      required
                      type="number"
                      min={0}
                      value={tier.regularPriceSgd}
                      onChange={(e) => updateTier(tier.id, { regularPriceSgd: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Early bird price (optional)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={tier.earlyBirdPriceSgd}
                      onChange={(e) => updateTier(tier.id, { earlyBirdPriceSgd: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Early bird quota</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="First N sign-ups"
                      value={tier.earlyBirdQuota}
                      onChange={(e) => updateTier(tier.id, { earlyBirdQuota: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Early bird cutoff</Label>
                    <Input
                      type="datetime-local"
                      value={tier.earlyBirdCutoffAt}
                      onChange={(e) => updateTier(tier.id, { earlyBirdCutoffAt: e.target.value })}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Early bird ends on whichever hits first — quota or cutoff date.
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/admin/schedule">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit">
            <Save className="h-4 w-4" /> Create workshop
          </Button>
        </div>
      </form>
    </div>
  );
}
