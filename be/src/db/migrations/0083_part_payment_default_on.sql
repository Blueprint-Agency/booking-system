-- Part Payment (#93) is offered by default: a studio created from here on
-- starts with it switched on, and turns it off in Admin → Policy if it does not
-- want it.
--
-- Only the column default moves. A studio that already has a policy row keeps
-- whatever it holds: a `false` there cannot be told apart from one an owner
-- chose, and flipping a studio's own terms of business overnight is worse than
-- leaving them alone.
ALTER TABLE "global_policy" ALTER COLUMN "part_payment_enabled" SET DEFAULT true;
