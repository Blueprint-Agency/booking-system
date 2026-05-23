"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  Input,
  Label,
  PageHeader,
} from "@/components/ui";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/formatters";

type StatusFilter = "all" | "active" | "suspended";

interface ApiClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "suspended";
  joined_at: string;
  suspended_at: string | null;
}

export default function ClientsPage() {
  const { api, currentStaff } = useWorkspace();
  const isSuperadmin = currentStaff?.role === "superadmin";
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ clients: ApiClient[] }>("/portal/admin/clients");
      setClients(res.clients);
    } catch (err) {
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accessAsClient(clientId: string) {
    if (!api) return;
    try {
      const res = await api.post<{
        ticket: string;
        grant: string;
        fe_client_url: string;
      }>(`/portal/admin/clients/${clientId}/impersonate`, {});
      window.open(res.fe_client_url, "_blank", "noopener");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        toast.error("This client hasn't activated their account yet.");
      } else if (err instanceof ApiError && err.status === 403) {
        toast.error("Only superadmins can impersonate.");
      } else {
        toast.error("Failed to start impersonation.");
      }
    }
  }

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        if (status !== "all" && c.status !== status) return false;
        if (query.trim()) {
          const q = query.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
          );
        }
        return true;
      }),
    [clients, status, query],
  );

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Members who self-registered via the client app or were added here. Adjustments and status toggles live on the profile."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Client
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 text-xs">
          {(["all", "active", "suspended"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 font-medium capitalize transition ${
                status === s
                  ? "bg-accent text-white"
                  : "bg-card text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          {filtered.length} of {clients.length}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading clients…
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-error">Failed to load: {error}</p>
            <Button size="sm" variant="ghost" onClick={load} className="mt-2">
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="divide-y divide-border sm:hidden">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/clients/${c.id}`}
                    className="flex items-start gap-3 p-4 hover:bg-paper"
                  >
                    <Avatar name={c.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink">{c.name}</span>
                        {c.status === "active" ? (
                          <Badge tone="sage">Active</Badge>
                        ) : (
                          <Badge tone="error">Suspended</Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">{c.email}</div>
                      <div className="mt-2 flex items-center gap-4 text-[11px] font-mono text-muted">
                        <span>{c.phone || "—"}</span>
                        <span className="ml-auto">{formatDate(c.joined_at)}</span>
                      </div>
                    </div>
                    {isSuperadmin && c.status === "active" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void accessAsClient(c.id);
                        }}
                        className="ml-auto"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> Access
                      </Button>
                    )}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead className="bg-paper">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Client</th>
                    <th className="px-5 py-3 font-medium">Phone</th>
                    <th className="px-5 py-3 font-medium">Joined</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    {isSuperadmin && <th className="px-5 py-3 font-medium" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-paper">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="flex items-center gap-3"
                        >
                          <Avatar name={c.name} size={32} />
                          <div>
                            <div className="font-medium text-ink">{c.name}</div>
                            <div className="text-xs text-muted">{c.email}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-sm text-muted">{c.phone || "—"}</td>
                      <td className="px-5 py-3 text-sm text-muted">{formatDate(c.joined_at)}</td>
                      <td className="px-5 py-3">
                        {c.status === "active" ? (
                          <Badge tone="sage">Active</Badge>
                        ) : (
                          <Badge tone="error">Suspended</Badge>
                        )}
                      </td>
                      {isSuperadmin && (
                        <td className="px-5 py-3 text-right">
                          {c.status === "active" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void accessAsClient(c.id);
                              }}
                              className="ml-auto"
                            >
                              <KeyRound className="h-3.5 w-3.5" /> Access
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-sm text-muted">No clients match.</div>
            )}
          </>
        )}
      </div>

      <AddClientDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function AddClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { api } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPhone("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    if (!api) return;
    if (!name.trim()) return setError("Name is required.");
    if (!email.trim()) return setError("Email is required.");
    if (!phone.trim()) return setError("Phone is required.");
    setError(null);
    setSaving(true);
    try {
      await api.post("/portal/admin/clients", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      toast.success("Client created — an invite email has been sent.");
      onCreated();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? "A client with this email already exists."
          : err instanceof ApiError
            ? `Could not create client (HTTP ${err.status}).`
            : "Could not create client.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add client"
      description="Creates the member's account and emails them an invite to sign in."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="client-name">Name</Label>
          <Input
            id="client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aisha Tan"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-email">Email</Label>
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. aisha@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client-phone">Phone</Label>
          <Input
            id="client-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +65 9123 4567"
          />
        </div>
        {error && (
          <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creating…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Add client
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
