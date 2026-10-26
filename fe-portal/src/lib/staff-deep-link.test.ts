import test from "node:test";
import assert from "node:assert";
import { staffLinkTarget } from "./staff-deep-link";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const staff = [
  { id: A, role: "admin" as const, status: "active" as const },
  { id: B, role: "instructor" as const, status: "active" as const },
  { id: C, role: "instructor" as const, status: "archived" as const },
];
const invitations = [
  { id: A, role: "instructor" as const, status: "pending" as const },
  { id: B, role: "admin" as const, status: "revoked" as const },
];

test("ATN-116 ?invitation= selects the invitation's role tab and the active view and names the invitation", () => {
  assert.deepEqual(staffLinkTarget(`?invitation=${A}`, staff, invitations), {
    kind: "invitation",
    id: A,
    tab: "instructors",
    view: "active",
  });
});

test("ATN-116 ?staff= selects the person's role tab, and Archived for an archived person", () => {
  assert.deepEqual(staffLinkTarget(`?staff=${A}`, staff, invitations), {
    kind: "staff",
    id: A,
    tab: "admin",
    view: "active",
  });
  assert.deepEqual(staffLinkTarget(`?staff=${C}`, staff, invitations), {
    kind: "staff",
    id: C,
    tab: "instructors",
    view: "archived",
  });
});

test("ATN-116 a link to something no longer there, a revoked invitation, or a non-id is no target", () => {
  assert.equal(staffLinkTarget(`?invitation=${B}`, staff, invitations), null);
  assert.equal(staffLinkTarget("?staff=44444444-4444-4444-8444-444444444444", staff, invitations), null);
  assert.equal(staffLinkTarget("?staff=not-an-id", staff, invitations), null);
  assert.equal(staffLinkTarget("", staff, invitations), null);
});
