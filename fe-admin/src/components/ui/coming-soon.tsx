import { PageHeader } from "./page-header";
import { Card, CardBody } from "./card";

export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: "Phase 2" | "Phase 3" | "Phase 4";
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody className="py-12 text-center">
          <p className="text-xs uppercase tracking-wider text-muted font-semibold">Ships in</p>
          <p className="text-3xl font-extrabold text-ink mt-1">{phase}</p>
          <p className="text-sm text-muted mt-4 max-w-md mx-auto">
            This module is scoped in the PRD at <code className="font-mono text-xs">docs/md/prd-admin.md</code>{" "}
            and will be implemented in the {phase} plan.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
