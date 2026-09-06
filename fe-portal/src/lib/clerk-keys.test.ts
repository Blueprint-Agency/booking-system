import test from "node:test";
import assert from "node:assert/strict";
import { portalClerkKeys, portalPublishableKey } from "./clerk-keys";

const STUDIO = "yogasadhana.portal.localhost:3001";
const SUPER = "admin.portal.localhost:3001";

/**
 * The env is read inside the functions rather than at module load, which is
 * what makes this file possible: a test can set the pair, call, and clear.
 */
const VARS = {
  publishableKey: "NEXT_PUBLIC_CLERK_PLATFORM_PUBLISHABLE_KEY",
  secretKey: "CLERK_PLATFORM_SECRET_KEY",
  encryptionKey: "CLERK_ENCRYPTION_KEY",
} as const;

type Setting = Partial<Record<keyof typeof VARS, string>>;

function withPlatformApp<T>(setting: Setting, run: () => T): T {
  const before = new Map(
    Object.values(VARS).map(name => [name, process.env[name]] as const),
  );
  try {
    for (const [key, name] of Object.entries(VARS)) {
      const value = setting[key as keyof typeof VARS];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return run();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const CONFIGURED = {
  publishableKey: "pk_test_platform",
  secretKey: "sk_test_platform",
  encryptionKey: "0123456789abcdef0123456789abcdef",
};

/** What the module actually returns — the encryption key is never handed out. */
const EXPECTED_KEYS = {
  publishableKey: CONFIGURED.publishableKey,
  secretKey: CONFIGURED.secretKey,
};

test("a studio's portal never uses the platform keys", () => {
  // Even fully configured. A studio's staff belong to the staff Clerk app, and
  // handing them the platform app's key would put every studio back on one
  // shared session — the thing the second application exists to end.
  withPlatformApp(CONFIGURED, () => {
    assert.deepEqual(portalClerkKeys(STUDIO), {});
    assert.equal(portalPublishableKey(STUDIO), undefined);
  });
});

test("the super portal uses its own Clerk application when one is configured", () => {
  withPlatformApp(CONFIGURED, () => {
    assert.deepEqual(portalClerkKeys(SUPER), EXPECTED_KEYS);
    assert.equal(portalPublishableKey(SUPER), "pk_test_platform");
  });
});

test("no platform application means the staff app, which is the old behaviour", () => {
  // `{}` is not a failure — it leaves Clerk on the ambient env vars, which is
  // the shared-session arrangement that shipped before these keys existed. The
  // backend still refuses anyone off `PLATFORM_ADMIN_EMAILS`.
  withPlatformApp({}, () => {
    assert.deepEqual(portalClerkKeys(SUPER), {});
    assert.equal(portalPublishableKey(SUPER), undefined);
  });
});

test("a partial configuration is treated as none", () => {
  // The failure it prevents is remote from its cause: tokens minted by one
  // instance and verified by another surface as a signature error, or as a
  // login page that loops, nowhere near the variable that was left blank.
  // Every way of leaving exactly one of the three out.
  for (const omitted of ["publishableKey", "secretKey", "encryptionKey"] as const) {
    const partial: Setting = { ...CONFIGURED };
    delete partial[omitted];
    withPlatformApp(partial, () => {
      assert.deepEqual(portalClerkKeys(SUPER), {}, `omitting ${omitted} should disable the app`);
    });
  }
});

test("a missing encryption key falls back rather than breaking every request", () => {
  // Not cosmetic. Clerk's `encryptClerkRequestData` throws when a `secretKey`
  // is passed to clerkMiddleware() without CLERK_ENCRYPTION_KEY, and it does so
  // on the NextResponse.next() path — every `pass()` in proxy.ts, `/login`
  // included. Returning the keys anyway would turn one blank variable into a
  // super portal that 500s on every request instead of one that shares a
  // session.
  withPlatformApp({ ...CONFIGURED, encryptionKey: undefined }, () => {
    assert.deepEqual(portalClerkKeys(SUPER), {});
    assert.equal(portalPublishableKey(SUPER), undefined);
  });
});

test("an empty string is not a key", () => {
  // How an unset Vercel/GitHub secret actually arrives — present but blank.
  withPlatformApp({ publishableKey: "", secretKey: "", encryptionKey: "" }, () => {
    assert.deepEqual(portalClerkKeys(SUPER), {});
  });
});

test("a host that names no portal at all gets no platform keys", () => {
  withPlatformApp(CONFIGURED, () => {
    assert.deepEqual(portalClerkKeys(null), {});
    assert.deepEqual(portalClerkKeys("portal.localhost:3001"), {});
    // The member app's hostname, which this middleware never serves anyway.
    assert.deepEqual(portalClerkKeys("yogasadhana.localhost:3000"), {});
  });
});
