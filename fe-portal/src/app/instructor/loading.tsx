import { ContentLoading } from "@/components/ui/content-loading";

/** While a page's code is on its way — see `app/admin/loading.tsx`. */
export default function Loading() {
  return <ContentLoading label="Loading page" />;
}
