import { MOCK_USER } from "@/data/mock-user";

const MOCK_EMAIL = "sarah.koh@example.com";

export function AccountHeader() {
  const initials =
    MOCK_USER.initials ??
    MOCK_USER.name
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="px-4 pb-6 border-b border-ink/10">
      <div className="h-16 w-16 rounded-full bg-accent/20 flex items-center justify-center text-lg font-semibold text-accent-deep">
        {initials}
      </div>
      <div className="mt-4">
        <div className="text-sm font-semibold text-ink">{MOCK_USER.name}</div>
        <div className="text-xs text-muted mt-0.5">{MOCK_EMAIL}</div>
      </div>
    </div>
  );
}
