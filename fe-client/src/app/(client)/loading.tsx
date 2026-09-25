import { ContentLoading } from "@/components/ui/content-loading";

/** While a page's code or server data is on its way: the app's centred spinner. */
export default function Loading() {
  return <ContentLoading label="Loading page" />;
}
