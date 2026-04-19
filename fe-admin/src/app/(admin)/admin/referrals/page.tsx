"use client";

import { PageHeader } from "@/components/ui";
import { ReferralReviewQueue } from "@/components/domain/referrals/referral-review-queue";
import { ReferralLeaderboard } from "@/components/domain/referrals/referral-leaderboard";

export default function ReferralsPage() {
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Review pending referrals and credit referrers; leaderboard tracks the top performers."
      />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ReferralReviewQueue />
        </div>
        <div>
          <ReferralLeaderboard />
        </div>
      </div>
    </>
  );
}
