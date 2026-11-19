import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHEDULE_ENTITY_KEY,
  entitySlugInPath,
  packageEntities,
  packagesHref,
  pickScheduleEntity,
  readRememberedEntity,
  rememberEntity,
  resolveEntity,
  showEntityButtons,
  showEntityDropdown,
  type PublicEntity,
} from "./entities.ts";

const yoga: PublicEntity = { id: "e1", name: "Yoga", slug: "yoga" };
const pilates: PublicEntity = { id: "e2", name: "Pilates", slug: "pilates" };
const barre: PublicEntity = { id: "e3", name: "Barre", slug: "barre" };

/** Stand in for the browser's `window` with `localStorage` as given, for the life of one callback. */
function withWindow(localStorage: () => Storage, run: () => void) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        return localStorage();
      },
    },
  });
  try {
    run();
  } finally {
    if (before) Object.defineProperty(globalThis, "window", before);
    else delete (globalThis as { window?: unknown }).window;
  }
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

test("CAT-27 the Entity buttons show for two or more Entities and never for one or none", () => {
  assert.equal(showEntityButtons([]), false);
  assert.equal(showEntityButtons([yoga]), false);
  assert.equal(showEntityButtons([yoga, pilates]), true);
  assert.equal(showEntityButtons([yoga, pilates, barre]), true);
});

test("CAT-28 the schedule opens on the first Entity on a first visit, and on the remembered one after", () => {
  assert.equal(pickScheduleEntity({ entities: [yoga, pilates], stored: null }), "yoga", "first visit: the first");
  assert.equal(pickScheduleEntity({ entities: [yoga, pilates, barre], stored: "pilates" }), "pilates");
  assert.equal(pickScheduleEntity({ entities: [yoga, pilates], stored: "PILATES" }), "pilates", "any casing, as the backend matches it");
  assert.equal(pickScheduleEntity({ entities: [pilates, yoga], stored: null }), "pilates", "the studio's order, not the alphabet");
  assert.equal(pickScheduleEntity({ entities: [], stored: "yoga" }), null, "nothing to choose from");
});

test("CAT-28 a remembered Entity that is no longer in the live list falls back to the first", () => {
  // Archived (or renamed to another slug) since the member last visited.
  assert.equal(pickScheduleEntity({ entities: [yoga, barre], stored: "pilates" }), "yoga");
  assert.equal(pickScheduleEntity({ entities: [yoga, barre], stored: "" }), "yoga");
  assert.equal(pickScheduleEntity({ entities: [yoga, barre], stored: "  " }), "yoga");
});

test("CAT-29 a pick is remembered in browser storage and read back", () => {
  const store = memoryStorage();
  withWindow(
    () => store,
    () => {
      assert.equal(readRememberedEntity(), null, "nothing remembered yet");
      rememberEntity("pilates");
      assert.equal(readRememberedEntity(), "pilates");
      assert.equal(store.getItem(SCHEDULE_ENTITY_KEY), "pilates");
      rememberEntity("yoga");
      assert.equal(readRememberedEntity(), "yoga", "the last pick wins");
    },
  );
});

test("CAT-29 unreadable or unwritable storage is no pick, not an error", () => {
  withWindow(
    () => {
      throw new DOMException("blocked", "SecurityError");
    },
    () => {
      assert.equal(readRememberedEntity(), null);
      assert.doesNotThrow(() => rememberEntity("pilates"));
    },
  );
  const refusing = memoryStorage();
  refusing.getItem = () => {
    throw new Error("denied");
  };
  refusing.setItem = () => {
    throw new DOMException("full", "QuotaExceededError");
  };
  withWindow(
    () => refusing,
    () => {
      assert.equal(readRememberedEntity(), null);
      assert.doesNotThrow(() => rememberEntity("pilates"));
    },
  );
  // No window at all (server render).
  assert.equal(readRememberedEntity(), null);
  assert.doesNotThrow(() => rememberEntity("pilates"));
});

// ── Packages menu (#561) ─────────────────────────────────────────────────────

const stocked = (e: PublicEntity): PublicEntity => ({ ...e, has_live_packages: true });
const empty = (e: PublicEntity): PublicEntity => ({ ...e, has_live_packages: false });

test("CAT-20 the Packages dropdown shows for two or more Entities with live packages, never for one", () => {
  assert.equal(showEntityDropdown([]), false);
  assert.equal(showEntityDropdown([stocked(yoga)]), false);
  assert.equal(showEntityDropdown([stocked(yoga), stocked(pilates)]), true);
  assert.equal(showEntityDropdown([stocked(yoga), stocked(pilates), stocked(barre)]), true);
});

test("CAT-20 an Entity with no live packages is left out, so a second Entity with nothing to buy does not make a dropdown", () => {
  assert.equal(showEntityDropdown([stocked(yoga), empty(pilates)]), false);
  assert.deepEqual(
    packageEntities([stocked(yoga), empty(pilates), stocked(barre)]).map((e) => e.slug),
    ["yoga", "barre"],
  );
});

test("CAT-20 a backend that does not say which Entities have packages counts every one as having some", () => {
  assert.equal(showEntityDropdown([yoga, pilates]), true);
  assert.equal(resolveEntity("pilates", [yoga, pilates])?.slug, "pilates");
});

test("CAT-20 a slug resolves to its Entity in any casing, and an unknown, empty or missing one to the first", () => {
  const list = [stocked(yoga), stocked(pilates), stocked(barre)];
  assert.equal(resolveEntity("pilates", list)?.slug, "pilates");
  assert.equal(resolveEntity("PiLaTeS", list)?.slug, "pilates");
  assert.equal(resolveEntity(" barre ", list)?.slug, "barre");
  for (const slug of ["reformer", "", "   ", null, undefined]) {
    assert.equal(resolveEntity(slug, list)?.slug, "yoga", String(slug));
  }
});

test("CAT-20 a slug naming an Entity with nothing on sale, or no Entity at all, falls back to the first with packages", () => {
  const list = [empty(yoga), stocked(pilates), stocked(barre)];
  assert.equal(resolveEntity("yoga", list)?.slug, "pilates");
  assert.equal(resolveEntity("barre", list)?.slug, "barre");
  assert.equal(resolveEntity("yoga", []), undefined);
  assert.equal(resolveEntity("yoga", [empty(yoga)]), undefined);
});

test("CAT-20 an Entity's packages are at /packages/<slug>, with an optional tab hash, and /packages when there is none", () => {
  assert.equal(packagesHref(), "/packages");
  assert.equal(packagesHref(null), "/packages");
  assert.equal(packagesHref(pilates), "/packages/pilates");
  assert.equal(packagesHref("pilates"), "/packages/pilates");
  assert.equal(packagesHref(pilates, "trial"), "/packages/pilates#trial");
  assert.equal(packagesHref(undefined, "private"), "/packages#private");
});

test("CAT-20 the Entity slug is read back out of a Packages path, and only out of one", () => {
  assert.equal(entitySlugInPath("/packages/pilates"), "pilates");
  assert.equal(entitySlugInPath("/packages/pilates/"), "pilates");
  assert.equal(entitySlugInPath("/packages"), undefined);
  assert.equal(entitySlugInPath("/account/packages"), undefined);
  assert.equal(entitySlugInPath("/packages/a/b"), undefined);
});
