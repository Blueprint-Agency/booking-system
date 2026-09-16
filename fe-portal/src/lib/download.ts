import { ApiError } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/api-url";
import { tenantRequestHeaders } from "@/lib/tenant-host";

/**
 * Download a file the API answers with — a studio archive, a member's data.
 *
 * Not through `api.get`, which parses JSON — these answer with a zip, and the
 * filename the person should see is on the `Content-Disposition` header rather
 * than in a body. So the fetch is done here and the browser is handed a blob.
 *
 * A link with `download` cannot carry the `Authorization` header the API needs,
 * which is why this is a fetch and a synthesised click rather than an anchor
 * pointing at the route.
 */
export async function downloadFile(
  getToken: () => Promise<string | null>,
  path: string,
  opts: { fallbackName: string; failure: string },
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      ...tenantRequestHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, undefined, opts.failure);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameFrom(res) ?? opts.fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: released immediately, the click may not have read
  // it yet in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The name the server chose, if it offered one. */
function filenameFrom(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  return header?.match(/filename="([^"]+)"/)?.[1] ?? null;
}
