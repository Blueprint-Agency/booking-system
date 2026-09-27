import { ContentLoading } from "@/components/ui/content-loading";

/**
 * While a page's code is on its way: the shell stays put and the app's one
 * centred spinner shows. Also what makes these routes' fallbacks prefetchable,
 * since the layout above reads the request's headers and so is dynamic.
 */
export default function Loading() {
  return <ContentLoading label="Loading page" />;
}
