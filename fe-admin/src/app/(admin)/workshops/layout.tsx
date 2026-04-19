import { PillarTabs } from "@/components/layout/pillar-tabs";

export default function WorkshopsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PillarTabs
        tabs={[
          { href: "/workshops", label: "Sessions" },
          { href: "/workshops/catalog", label: "Catalog" },
        ]}
      />
      {children}
    </div>
  );
}
