import PackagesPage from "../page";

/**
 * `/packages/<entity-slug>`: one Entity's packages. It is the Packages page
 * itself, which reads the slug from the route (`useParams`) and falls back to
 * the first Entity for one that names none, so the hash deep links (`#trial`,
 * `#1on1`, …) work here exactly as they do on `/packages`.
 */
export default function EntityPackagesPage() {
  return <PackagesPage />;
}
