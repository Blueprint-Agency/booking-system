"use client";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { Entity } from "@/lib/entities";

const NEW_ENTITY = "__new__";

/**
 * An Entity dropdown with "+ New entity", so an admin can start an Entity such as
 * Pilates from the form that needs it without leaving. `onCreate` makes the
 * Entity (and says why if it cannot, by throwing a sentence); the new one is
 * chosen as soon as it exists. Shared by the Class Type editor and the package
 * forms (`components/packages/entity-picker.tsx`). `placeholder` is the
 * disabled first option shown while nothing is chosen.
 */
export function EntitySelect({
  id,
  entities,
  value,
  onChange,
  onCreate,
  disabled,
  placeholder,
}: {
  id: string;
  entities: readonly { id: string; name: string }[];
  value: string;
  onChange: (entityId: string) => void;
  onCreate: (name: string) => Promise<Entity>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await onCreate(name.trim());
      onChange(made.id);
      setNaming(false);
      setName("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't add that entity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Select
        id={id}
        value={naming ? NEW_ENTITY : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === NEW_ENTITY) {
            setNaming(true);
            return;
          }
          setNaming(false);
          onChange(e.target.value);
        }}
      >
        {!value && !naming && <option value="">{placeholder ?? "Choose an entity"}</option>}
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
        <option value={NEW_ENTITY}>+ New entity…</option>
      </Select>
      {naming && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              aria-label="New entity name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds the entity; it must not submit the form it sits in.
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="e.g. Pilates"
            />
            <Button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
              Add
            </Button>
          </div>
          {problem && <p className="text-xs text-error">{problem}</p>}
        </div>
      )}
    </div>
  );
}
