"use client";

import { useState } from "react";
import { Users, UserCheck, Coins, Share2, BookOpen, Gift } from "lucide-react";
import { SectionHeading } from "@/components/booking/section-heading";

const REFERRAL_CODE = "YS0001";
const REFERRAL_LINK = `https://yogasadhana.sg/join?ref=${REFERRAL_CODE}`;
const FRIENDS_INVITED = 0;
const FRIENDS_JOINED = 0;
const CREDITS_EARNED = FRIENDS_JOINED * 20;

export default function ReferralPage() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(REFERRAL_LINK);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `Join me at Yoga Sadhana — use my link for S$20 credit: ${REFERRAL_LINK}`
  )}`;
  const emailHref = `mailto:?subject=${encodeURIComponent(
    "Join me at Yoga Sadhana"
  )}&body=${encodeURIComponent(
    `I think you'd love Yoga Sadhana. Sign up with my link and we both get S$20 credit: ${REFERRAL_LINK}`
  )}`;

  return (
    <div>
      <SectionHeading eyebrow="Referral" title="Invite friends, earn credits" />

      {/* Link card */}
      <div className="rounded-3xl bg-accent/10 border border-accent/30 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            readOnly
            value={REFERRAL_LINK}
            className="flex-1 min-w-0 rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm font-mono text-ink/80"
          />
          <button
            onClick={handleCopy}
            className="rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium whitespace-nowrap"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <div className="flex gap-2 mt-4">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent"
          >
            WhatsApp
          </a>
          <a
            href={emailHref}
            className="rounded-full border border-ink/10 px-4 py-2 text-xs font-medium hover:border-accent"
          >
            Email
          </a>
        </div>
      </div>

      {/* Earnings tracker */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="rounded-2xl bg-paper border border-ink/10 p-5 sm:p-6">
          <Users className="w-5 h-5 text-accent-deep" strokeWidth={1.8} />
          <p className="text-2xl sm:text-3xl font-extrabold mt-3 text-ink">{FRIENDS_INVITED}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-2">Friends invited</p>
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-5 sm:p-6">
          <UserCheck className="w-5 h-5 text-accent-deep" strokeWidth={1.8} />
          <p className="text-2xl sm:text-3xl font-extrabold mt-3 text-ink">{FRIENDS_JOINED}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-2">Friends joined</p>
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-5 sm:p-6">
          <Coins className="w-5 h-5 text-accent-deep" strokeWidth={1.8} />
          <p className="text-2xl sm:text-3xl font-extrabold mt-3 text-ink">S${CREDITS_EARNED}</p>
          <p className="text-xs uppercase tracking-wider text-muted mt-2">Credits earned</p>
        </div>
      </div>

      {/* How it works strip */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <p className="text-xs font-mono text-accent-deep">01</p>
          <h3 className="text-base font-semibold mt-2 text-ink flex items-center gap-2">
            <Share2 className="w-4 h-4" strokeWidth={1.8} />
            Share your link
          </h3>
          <p className="text-sm text-muted mt-2">
            Send your personal referral link to friends via WhatsApp, email, or social.
          </p>
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <p className="text-xs font-mono text-accent-deep">02</p>
          <h3 className="text-base font-semibold mt-2 text-ink flex items-center gap-2">
            <BookOpen className="w-4 h-4" strokeWidth={1.8} />
            Friend books their first class
          </h3>
          <p className="text-sm text-muted mt-2">
            They sign up with your link and complete their first class at the studio.
          </p>
        </div>
        <div className="rounded-2xl bg-paper border border-ink/10 p-6">
          <p className="text-xs font-mono text-accent-deep">03</p>
          <h3 className="text-base font-semibold mt-2 text-ink flex items-center gap-2">
            <Gift className="w-4 h-4" strokeWidth={1.8} />
            Both of you get credits
          </h3>
          <p className="text-sm text-muted mt-2">
            You each receive S$20 in studio credit to spend on classes or packages.
          </p>
        </div>
      </div>
    </div>
  );
}
