# Every package activates on its first booking, and one runs per Family

**Status**: accepted (2026-09-12) — supersedes the "only an Unlimited Plan can be Dormant" rule in `docs/md/spec-pre-launch-batch.md` §3 and the one-Activated-Unlimited index in §6. The Home Location, Add-On, and renewal-Location rules there all stand.

Until now a Credit Bundle, a trial and a PT package started their clock at purchase, and only an Unlimited Plan bought *behind* another one waited Dormant. Nothing stopped two Credit Bundles or two PT packages from running side by side. The studio has decided otherwise: a package is valid from the day it is first used, not the day it is paid for, and a member runs one package at a time.

## What changed

**Every purchase lands Dormant.** `expires_at` is null on every new row of every kind. The first booking a package pays for is its **Activation** and stamps the end date from *that* day — one Duration forward for an Unlimited Plan, `validity_days` forward for everything else. For the class family the booking is a confirmed class booking; for PT it is the session request that debits the first session.

**`validity_days` is frozen onto the purchase**, exactly as `duration_months` already was and for the same reason: Activation reads the length later, the catalogue row is admin-editable, and re-reading it would silently relengthen every package already sold. The `client_packages_kind_fields` check now requires one length or the other by kind, and allows a null expiry on every kind.

**One Activated package per Family.** The class family is Credit Bundle + Unlimited + trial; PT is its own. Two partial unique indexes on `(client_id)` replace the old Unlimited-only one. Selection (`services/packages/selection.ts`) is the enforcement; the indexes are the backstop for a race or a bug, and staff hit them too — giving a Dormant package a date in the portal while another is running is refused as `family_already_activated`.

**Waiting packages start in purchase order.** With nothing running, the next booking Activates the package bought first. The member's one lever is `use_credits`, which starts a waiting bundle instead of a waiting plan (§3's escape, unchanged).

## The strict reading, and what it costs

While a package runs it is the **only** one in its Family that can pay. This was the decision put to the studio and taken deliberately over the alternative of letting an Unlimited Plan jump a running bundle:

- A member with three credits left who buys an Unlimited Plan uses the credits first. The plan waits, and starts on their first booking after the credits are gone or expired.
- A member with a running plan at one studio cannot spend waiting credits at the other. The Cross-Location Add-On is the remedy for that, as it already was; credits are not.
- A running 1-on-1 PT package holds a waiting 2-on-1 package behind it, and vice versa.
- A running bundle with one credit left and classes that cost two is stuck until it expires. Rare; an admin can zero the balance, which ends it.

**Rejected**: letting an Unlimited Plan run beside a bundle. That is two Activated packages in one Family, which is exactly the state the rule exists to prevent, and it reintroduces the question selection was built to answer — which of two live packages pays — with the credit-spent-silently defect one step behind it.

## Ended, and the sweep

A package has ended when it expires, is spent to zero, or is refunded. "Spent to zero" already flips `active` in the ledger. "Expired" was flipped by a nightly cron, which left a window: between midnight and 01:00 a dead package still said `active`, held its Family's slot, and would have blocked the next Activation. The class and PT booking paths now sweep the member's own expired rows at the top of the transaction (`services/packages/activation.ts`), so the cron is a tidy-up rather than a gate.

A spent package keeps its stamp, and credits can come back to it — a cancelled class refunds, an admin tops it up. If nothing else in the Family is running by then, it simply resumes on its old clock. If the next package has already Activated, reviving it with the old stamp would be two Activated in one Family, so the ledger and the admin adjust path return it to **Dormant** instead (`revivalPatch`): the credits are kept, the package waits its turn, and its clock starts afresh on the day it is next used. Generous rather than lossy, for the same reason the conversion below is.

## Conversion of existing rows

Migration `0046` converts rather than grandfathers. It runs the expiry sweep first, so a package that ended since the last cron is neither revived nor handed a Family's slot. A package with a clock running but nothing ever booked on it was never Activated in the new sense; it returns to Dormant and keeps its whole validity for whenever it is first used — generous, never lossy. Where two booked packages in one Family were both running, the soonest to end stays running and the other waits behind it, which is the state the rule would have produced.

## Left open

- **An activation deadline.** Unchanged from the spec: a package bought today and first used in three years is honoured. The purchase timestamp is stored, so "must activate within N days" is a later query, not a migration.
- **The catalogue-side purchase blocks in `fe-client`** ("can't buy a bundle while Unlimited is active") are gone — a purchase on top of a running package is allowed and waits. They were never enforced by the backend.
