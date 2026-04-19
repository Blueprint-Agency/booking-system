import { PillarTabs } from "@/components/layout/pillar-tabs";

export default function ClassesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PillarTabs
        tabs={[
          { href: "/classes/schedule", label: "Schedule" },
          { href: "/classes/templates", label: "Templates" },
          { href: "/classes/packages", label: "Packages" },
        ]}
      />
      {children}
    </div>
  );
}
