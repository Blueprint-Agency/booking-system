-- A PT package can be sold bound to one instructor.
--
-- Two columns, and only one of them is a flag. `pt_packages.instructor_bound`
-- is the catalogue's question to the member at checkout; it defaults false, so
-- every package already on sale keeps behaving exactly as it does today.
-- `client_packages.bound_instructor_id` is the answer, and it is the WHOLE of
-- what "bound" means on a purchase — there is no second flag beside it to fall
-- out of step, and an admin can bind a package sold open simply by filling it.
--
-- `restrict` on the FK because a bound package outlives its instructor's
-- archival: it stays bound and visibly so, rather than silently reopening to
-- the whole roster.
--
-- The kind-fields check is rewritten rather than added to, because it is one
-- constraint: only a PT package may carry a binding, for the same reason only
-- an Unlimited Plan may carry a Home Location. Every existing row satisfies the
-- new arm — the column is new, so it is null everywhere.
ALTER TABLE "client_packages" DROP CONSTRAINT "client_packages_kind_fields";--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "bound_instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD COLUMN "instructor_bound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_bound_instructor_id_staff_users_id_fk" FOREIGN KEY ("bound_instructor_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_kind_fields" CHECK (
        ("client_packages"."kind" = 'unlimited'
          AND "client_packages"."location_id" IS NOT NULL
          AND "client_packages"."duration_months" IS NOT NULL
          AND "client_packages"."bound_instructor_id" IS NULL)
        OR
        ("client_packages"."kind" <> 'unlimited'
          AND "client_packages"."location_id" IS NULL
          AND "client_packages"."duration_months" IS NULL
          AND "client_packages"."cross_location_paid_sgd" IS NULL
          AND "client_packages"."expires_at" IS NOT NULL
          AND ("client_packages"."kind" = 'pt' OR "client_packages"."bound_instructor_id" IS NULL))
      );