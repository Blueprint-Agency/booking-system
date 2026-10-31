import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { StudioZoneChoices } from "@/lib/studio-time-zones";

/**
 * The New studio form's time zone: a select over the runtime's IANA zones, or
 * a text field where the browser has no such list (the API then checks what is
 * typed). Its help text is tied to it for screen readers.
 */
export function StudioZoneField({
  zone,
  onChange,
  choices,
}: {
  zone: string;
  onChange: (zone: string) => void;
  choices: StudioZoneChoices;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="tenant-timezone">Time zone</Label>
      {choices.freeText ? (
        <Input
          id="tenant-timezone"
          value={zone}
          onChange={e => onChange(e.target.value)}
          placeholder="Australia/Sydney"
          autoComplete="off"
          spellCheck={false}
          required
          aria-describedby="tenant-timezone-help"
        />
      ) : (
        <Select
          id="tenant-timezone"
          value={zone}
          onChange={e => onChange(e.target.value)}
          required
          aria-describedby="tenant-timezone-help"
        >
          {!zone && <option value="">Choose a time zone</option>}
          {choices.zones.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      )}
      <p id="tenant-timezone-help" className="text-xs text-muted">
        {choices.initial
          ? "Starts on your browser’s zone. "
          : ""}
        It is the studio’s clock for every class, leave day and scheduled job, and it cannot be
        changed once the studio is created.
      </p>
    </div>
  );
}
