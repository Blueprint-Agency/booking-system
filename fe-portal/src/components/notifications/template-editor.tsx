"use client";
import { useState, useMemo } from "react";
import { Save, AlertCircle } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui";
import type { EmailTemplate } from "@/types";

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function TemplateEditor({ template }: { template: EmailTemplate }) {
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [saved, setSaved] = useState<string | null>(template.updatedAt);

  const detected = useMemo(() => {
    const found = new Set<string>();
    for (const m of subject.matchAll(VAR_RE)) found.add(m[1]);
    for (const m of bodyHtml.matchAll(VAR_RE)) found.add(m[1]);
    return Array.from(found);
  }, [subject, bodyHtml]);

  const allowed = new Set(template.variables);
  const unknown = detected.filter((v) => !allowed.has(v));
  const unused = template.variables.filter((v) => !detected.includes(v));

  const dirty = subject !== template.subject || bodyHtml !== template.bodyHtml;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(new Date().toISOString());
    alert("Template saved (mock).");
  }

  return (
    <form onSubmit={handleSave} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="font-medium"
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Label htmlFor="body">Body</Label>
            <span className="text-[11px] text-muted">
              Rich text editor in production · plain HTML mock-up here
            </span>
          </div>
          <textarea
            id="body"
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            className="font-mono flex min-h-[280px] w-full rounded-lg border border-border bg-paper px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h3 className="mb-2 text-sm font-semibold text-ink">Preview</h3>
          <div className="rounded-lg border border-border bg-paper p-4">
            <div className="mb-3 border-b border-border pb-2 text-sm font-semibold text-ink">
              {highlight(subject, allowed)}
            </div>
            <div
              className="prose-sm [&_p]:my-2 [&_p]:text-sm [&_a]:text-accent"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted">
            {saved && `Last saved ${new Date(saved).toLocaleString()}`}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty}
              onClick={() => {
                setSubject(template.subject);
                setBodyHtml(template.bodyHtml);
              }}
            >
              Reset
            </Button>
            <Button type="submit" disabled={!dirty}>
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        </div>
      </div>

      <aside className="space-y-3">
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <h3 className="mb-2 text-sm font-semibold text-ink">Available variables</h3>
          <p className="mb-3 text-xs text-muted">
            Wrap with double braces, e.g. <code className="font-mono">{`{{client_name}}`}</code>.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map((v) => (
              <code
                key={v}
                onClick={() => navigator.clipboard?.writeText(`{{${v}}}`)}
                className={`cursor-pointer rounded-md border border-border bg-paper px-2 py-1 font-mono text-[11px] text-ink hover:border-accent hover:text-accent ${
                  detected.includes(v) ? "border-accent/30" : ""
                }`}
                title="Click to copy"
              >
                {`{{${v}}}`}
              </code>
            ))}
          </div>
        </section>

        {unknown.length > 0 && (
          <section className="rounded-xl border border-warning bg-warning/5 p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-warning">
              <AlertCircle className="h-3.5 w-3.5" />
              Unrecognised variables
            </div>
            <p className="mb-2 text-[11px] text-muted">
              Will render as blank in production.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unknown.map((v) => (
                <Badge key={v} tone="warning">
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {unused.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="mb-1.5 text-xs font-semibold text-muted">Unused</div>
            <div className="flex flex-wrap gap-1.5">
              {unused.map((v) => (
                <Badge key={v} tone="neutral">
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </aside>
    </form>
  );
}

function highlight(text: string, allowed: Set<string>): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  for (const match of text.matchAll(VAR_RE)) {
    if (match.index! > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const name = match[1];
    parts.push(
      <span
        key={`v-${i++}`}
        className={`rounded px-1 font-mono text-[12px] ${
          allowed.has(name) ? "bg-accent/10 text-accent" : "bg-warning/15 text-warning"
        }`}
      >
        {match[0]}
      </span>
    );
    lastIdx = match.index! + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
