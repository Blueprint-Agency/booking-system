import { PillarTabs } from "@/components/layout/pillar-tabs";

export default function PrivateSessionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PillarTabs
        tabs={[
          { href: "/private-sessions/requests", label: "Requests" },
          { href: "/private-sessions/upcoming", label: "Upcoming" },
          { href: "/private-sessions/packs", label: "Packs" },
        ]}
      />
      {children}
    </div>
  );
}
