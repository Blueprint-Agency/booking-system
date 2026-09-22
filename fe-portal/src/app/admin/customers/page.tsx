"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Plus, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DEFAULT_PAGE_SIZE,
  Input,
  isPageSize,
  Label,
  PageHeader,
  Pagination,
  Select,
} from "@/components/ui";
import { runsStudio } from "@/lib/staff-role";
import { useWorkspace } from "@/lib/workspace-context";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/formatters";

type StatusFilter = "all" | "active" | "trials" | "blocked";
type SortKey = "joined" | "name";

/** Wait this long after the last keystroke before searching the whole studio. */
const SEARCH_DEBOUNCE_MS = 300;

/** Nothing outside the Trials filter has a trial date, so nothing else asks. */
function trialStarted(c: ApiClient): string {
  return c.trial_started_at ? formatDate(c.trial_started_at) : "—";
}

interface ApiClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  joined_at: string;
  /** Set = blocked. Only returned when the caller asked to include them. */
  deleted_at: string | null;
  /** First trial purchase. Null = never bought a trial. */
  trial_started_at: string | null;
  /** Classes turned up to ON the trial — not attendance overall. Zero is the follow-up signal. */
  attended: number;
  /** Paid for something that isn't another trial. A comped grant doesn't count. */
  converted: boolean;
}

/** The Trial Funnel over every member the Trials filter matches, counted by the backend. */
interface ApiFunnel {
  trials: number;
  attended: number;
  converted: number;
}

interface ApiClientPage {
  clients: ApiClient[];
  /** Matching members across every page. */
  total: number;
  page: number;
  page_size: number;
  funnel: ApiFunnel | null;
}

/**
 * The list's position — filter, search, sort, page — kept in the address bar,
 * so opening a customer and pressing Back lands on the same page of the same
 * search rather than page one of everybody.
 */
interface ListState {
  q: string;
  status: StatusFilter;
  sort: SortKey;
  page: number;
  pageSize: number;
}

function readState(search: string): ListState {
  const p = new URLSearchParams(search);
  const status = p.get("filter");
  const sort = p.get("sort");
  const page = Number(p.get("page"));
  const size = Number(p.get("size"));
  return {
    q: p.get("q") ?? "",
    status: status === "active" || status === "trials" || status === "blocked" ? status : "all",
    sort: sort === "name" ? "name" : "joined",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeState(s: ListState) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.status !== "all") p.set("filter", s.status);
  if (s.sort !== "joined") p.set("sort", s.sort);
  if (s.page !== 1) p.set("page", String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) p.set("size", String(s.pageSize));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// `useSearchParams` needs a Suspense boundary above it, or the build bails out
// of prerendering the whole route.
export default function CustomersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading customers…
        </div>
      }
    >
      <CustomersList />
    </Suspense>
  );
}

function CustomersList() {
  const { api, currentStaff } = useWorkspace();
  const isAdmin = runsStudio(currentStaff?.role);
  const searchParams = useSearchParams();
  // Read once: afterwards the list owns its position and writes it back.
  const [state, setState] = useState<ListState>(() => readState(searchParams.toString()));
  // What is typed, ahead of the debounced `state.q` the backend is asked for.
  const [query, setQuery] = useState(state.q);
  const [result, setResult] = useState<ApiClientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Only the newest request may paint: a slow page-3 response must not land on
  // top of the page-4 one the admin has already moved to.
  const requestSeq = useRef(0);

  const update = useCallback((patch: Partial<ListState>) => {
    setState((s) => {
      // Anything but a page move starts again at page one — page 12 of a
      // search that now has two pages is an empty screen.
      const next = { ...s, ...patch, page: patch.page ?? 1 };
      writeState(next);
      return next;
    });
  }, []);

  // Debounce the search box into the list state.
  useEffect(() => {
    if (query.trim() === state.q) return;
    const t = setTimeout(() => update({ q: query.trim() }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, state, update]);

  const load = useCallback(async () => {
    if (!api) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiClientPage>("/portal/admin/clients", {
        q: state.q || undefined,
        filter: state.status === "all" ? undefined : state.status,
        sort: state.sort,
        page: state.page,
        page_size: state.pageSize,
        // Blocked clients are filtered out server-side unless asked for.
        include_deleted: isAdmin ? "true" : undefined,
      });
      if (seq !== requestSeq.current) return;
      setResult(res);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof ApiError ? `HTTP ${err.status}` : "Network error");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [api, state, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accessAsClient(clientId: string) {
    if (!api) return;
    try {
      const res = await api.post<{
        token: string;
        grant: string;
        fe_client_url: string;
      }>(`/portal/admin/clients/${clientId}/impersonate`, {});
      window.open(res.fe_client_url, "_blank", "noopener");
    } catch (err) {
      const reason = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      if (reason === "client_blocked") {
        toast.error("This customer is blocked. Restore them to impersonate.");
      } else if (err instanceof ApiError && err.status === 422) {
        toast.error("This customer hasn't activated their account yet.");
      } else if (err instanceof ApiError && err.status === 403) {
        toast.error("Only admins can impersonate.");
      } else {
        toast.error("Failed to start impersonation.");
      }
    }
  }

  const { status, page, pageSize } = state;
  const showTrials = status === "trials";
  const rows = result?.clients ?? [];
  const total = result?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Members who self-registered via the customer app, were added here, or were imported. Open one to see their packages, bookings and payments."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Customer
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search by name, email or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        <div className="flex gap-1.5 text-xs">
          {((isAdmin
            ? ["all", "active", "trials", "blocked"]
            : ["all", "active", "trials"]) as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ status: s })}
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
        <Select
          value={state.sort}
          onChange={(e) => update({ sort: e.target.value as SortKey })}
          className="h-8 w-auto py-1 text-xs"
          aria-label="Sort customers"
        >
          <option value="joined">Newest first</option>
          <option value="name">Name A–Z</option>
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted">
          {result ? `${total.toLocaleString()} customer${total === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {showTrials && result?.funnel && !error && <TrialFunnel funnel={result.funnel} />}

      <div className="rounded-xl border border-border bg-card shadow-soft">
        {loading && !result ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading customers…
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-error">Failed to load: {error}</p>
            <Button size="sm" variant="ghost" onClick={load} className="mt-2">
              Retry
            </Button>
          </div>
        ) : (
          // Dimmed rather than blanked while the next page loads, so the pager
          // does not jump under the admin's cursor.
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {/* Mobile cards */}
            <ul className="divide-y divide-border sm:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/customers/${c.id}`}
                    className="flex items-start gap-3 p-4 hover:bg-paper"
                  >
                    <Avatar name={c.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink">{c.name}</span>
                        <StatusCell client={c} showTrials={showTrials} />
                      </div>
                      <div className="truncate text-xs text-muted">{c.email}</div>
                      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted">
                        <span>{c.phone || "—"}</span>
                        {showTrials && <span>{c.attended} attended</span>}
                        <span className="ml-auto">
                          {showTrials ? trialStarted(c) : formatDate(c.joined_at, "d MMM yyyy")}
                        </span>
                      </div>
                    </div>
                    {isAdmin && !c.deleted_at && (
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
              {/* Tablet width still needs the scroll: min-w gives the wrapper
                  something to scroll rather than crushing the columns. */}
              <table className="w-full min-w-[720px]">
                <thead className="bg-paper">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Phone</th>
                    <th className="px-5 py-3 font-medium">
                      {showTrials ? "Trial started" : "Joined"}
                    </th>
                    {showTrials && <th className="px-5 py-3 font-medium">Attended</th>}
                    <th className="px-5 py-3 font-medium">Status</th>
                    {isAdmin && <th className="px-5 py-3 font-medium" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-paper">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/customers/${c.id}`}
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
                      <td className="px-5 py-3 text-sm text-muted">
                        {showTrials ? trialStarted(c) : formatDate(c.joined_at, "d MMM yyyy")}
                      </td>
                      {showTrials && (
                        <td
                          className={`px-5 py-3 text-sm tabular-nums ${
                            c.attended === 0 ? "text-warning" : "text-ink"
                          }`}
                        >
                          {c.attended}
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <StatusCell client={c} showTrials={showTrials} />
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3 text-right">
                          {!c.deleted_at && (
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
            {rows.length === 0 && (
              <div className="py-12 text-center text-sm text-muted">
                {total > 0 ? "Nothing on this page." : "No customers match."}
              </div>
            )}

            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              loading={loading}
              noun="customers"
              onPageChange={(n) => update({ page: n })}
              onPageSizeChange={(n) => update({ pageSize: n })}
            />
          </div>
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

function StatusCell({ client: c, showTrials }: { client: ApiClient; showTrials: boolean }) {
  if (c.deleted_at) return <Badge tone="error">Blocked</Badge>;
  if (showTrials) {
    return (
      <Badge tone={c.converted ? "sage" : "warning"}>
        {c.converted ? "Converted" : "Follow up"}
      </Badge>
    );
  }
  return <Badge tone="sage">Active</Badge>;
}

/**
 * The trial funnel over every member the Trials filter matches — bought,
 * turned up, converted. Counted by the backend across all pages, so a number
 * here never depends on how many rows are on screen.
 */
function TrialFunnel({ funnel }: { funnel: ApiFunnel }) {
  const steps = [
    { label: "Bought a trial", value: funnel.trials },
    { label: "Attended their trial", value: funnel.attended },
    { label: "Converted", value: funnel.converted, hint: "Went on to pay for a package" },
  ];
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-3">
      {steps.map((s) => (
        <div key={s.label} className="rounded-xl border border-border bg-card p-3 shadow-soft">
          <div className="text-xs text-muted">{s.label}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums text-ink">
              {s.value.toLocaleString()}
            </span>
            {/* Share of trials, not of the previous step — an owner asks "how
                many of the people who tried", never "how many of the ones who
                turned up". */}
            {funnel.trials > 0 && s.value !== funnel.trials && (
              <span className="text-xs text-muted tabular-nums">
                {Math.round((s.value / funnel.trials) * 100)}%
              </span>
            )}
          </div>
          {s.hint && <div className="mt-0.5 text-[10px] leading-tight text-muted">{s.hint}</div>}
        </div>
      ))}
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
      toast.success("Customer created — an invite email has been sent.");
      onCreated();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? "A customer with this email already exists."
          : err instanceof ApiError
            ? `Could not create customer (HTTP ${err.status}).`
            : "Could not create customer.";
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
      title="Add customer"
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
              <Plus className="h-4 w-4" /> Add customer
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
