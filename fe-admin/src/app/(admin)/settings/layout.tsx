import { PillarTabs } from "@/components/layout/pillar-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PillarTabs
        tabs={[
          { href: "/settings/studio", label: "Studio" },
          { href: "/settings/admins", label: "Admin users" },
          { href: "/settings/notifications", label: "Notifications" },
          { href: "/settings/waivers", label: "Waivers" },
          { href: "/settings/referrals", label: "Referrals" },
        ]}
      />
      {children}
    </div>
  );
}
