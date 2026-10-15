-- The studio's contact email on its Receipts (#403, spec #397): its reply-to
-- address, copied onto each Receipt when it is issued, as everything else in
-- the seller block is, so a later change of address reaches only the Receipts
-- issued after it. Nullable: a studio may have none, and no Receipt issued
-- before this carries one.
ALTER TABLE "receipts" ADD COLUMN "seller_email" text;
