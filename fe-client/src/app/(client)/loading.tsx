import { PageLoader } from "@/components/layout/page-loader";

/** While a page's code or server data is on its way: the centred loader. */
export default function Loading() {
  return <PageLoader delayed />;
}
