"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { Button, Input, Label, PageHeader } from "@/components/ui";
import { classTypes, instructors, locations } from "@/data";
import { CapacityFields } from "@/components/schedule/capacity-fields";
import type { Capacity, ClassTypeDifficulty } from "@/types";

const DIFFICULTIES: ClassTypeDifficulty[] = ["general", "beginner", "intermediate", "advanced"];

export default function NewClassPage() {
  const router = useRouter();
  const [classTypeId, setClassTypeId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("75");
  const [capacity, setCapacity] = useState<Capacity>({
    waitlist: 0,
    onlineBooking: 18,
    buffer: 2,
  });
  const [creditCost, setCreditCost] = useState("1");
  const [difficulty, setDifficulty] = useState<ClassTypeDifficulty>("general");

  const eligibleInstructors = useMemo(
    () =>
      instructors.filter(
        (i) => !i.archivedAt && (!classTypeId || i.eligibleClassTypeIds.includes(classTypeId))
      ),
    [classTypeId]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void difficulty;
    alert(
      `Class instance created (mock).\n\nThe class is now visible on the timetable and occupies the instructor's availability slot.`
    );
    router.push("/admin/schedule");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/schedule"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Schedule
      </Link>
      <PageHeader
        title="New class"
        description="Single class instance. The class will appear on the timetable and occupy the instructor's availability slot."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Class details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ct">Class type</Label>
              <SelectField
                id="ct"
                value={classTypeId}
                onChange={(v) => {
                  setClassTypeId(v);
                  setInstructorId("");
                }}
                placeholder="Select…"
                options={classTypes
                  .filter((c) => !c.archivedAt)
                  .map((c) => ({ val: c.id, label: c.name }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins">Instructor</Label>
              <SelectField
                id="ins"
                value={instructorId}
                onChange={setInstructorId}
                placeholder={classTypeId ? "Select…" : "Pick a class type first"}
                disabled={!classTypeId}
                options={eligibleInstructors.map((i) => ({ val: i.id, label: i.name }))}
              />
              {classTypeId && (
                <p className="text-xs text-muted">
                  {eligibleInstructors.length} eligible
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="loc">Location</Label>
              <SelectField
                id="loc"
                value={locationId}
                onChange={setLocationId}
                placeholder="Select…"
                options={locations
                  .filter((l) => !l.archivedAt)
                  .map((l) => ({ val: l.id, label: l.name }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Difficulty</Label>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      difficulty === d
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-border bg-card text-muted hover:border-accent/40"
                    }`}
                  >
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                Set per-instance — the same class type can run at different levels.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">When</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="d">Date</Label>
              <Input id="d" required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t">Start time</Label>
              <Input id="t" required type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dur">Duration (min)</Label>
              <Input
                id="dur"
                required
                type="number"
                min={15}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Capacity & price</h2>
          <div className="space-y-4">
            <CapacityFields value={capacity} onChange={setCapacity} />
            <div className="space-y-1.5">
              <Label htmlFor="credit">Credit cost</Label>
              <Input
                id="credit"
                required
                type="number"
                min={0}
                step={1}
                value={creditCost}
                onChange={(e) => setCreditCost(e.target.value)}
              />
              <p className="text-xs text-muted">Credits charged per booking on this instance.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/admin/schedule">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit">
            <Save className="h-4 w-4" /> Create class
          </Button>
        </div>
      </form>
    </div>
  );
}

function SelectField({
  id,
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: { val: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      required
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.val} value={o.val}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
