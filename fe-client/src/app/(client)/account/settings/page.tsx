"use client";

import { AccountPageHeader } from "@/components/account/account-page-header";
import { GeneralSettingsCard } from "@/components/account/general-settings-card";

/** How the app looks for the member: theme and text size. */
export default function GeneralSettingsPage() {
  return (
    <div>
      <AccountPageHeader
        title="General settings"
        description="Choose how the app looks for you."
      />
      <div className="max-w-3xl space-y-5">
        <GeneralSettingsCard />
      </div>
    </div>
  );
}
