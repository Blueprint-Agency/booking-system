"use client";

import { useState } from "react";
import { motion } from "framer-motion";

// Mock referral data for cli-1
const REFERRAL_CODE = "YS8472";
const REFERRAL_LINK = `https://yogasadhana.sg/join?ref=${REFERRAL_CODE}`;
const REFERRALS_USED = 2;
const REFERRAL_REWARD = "S$20 credit per successful referral";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-accent-deep border border-accent/30 rounded-md bg-accent-glow/10 hover:bg-accent-glow/25 transition-colors"
    >
      {copied ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

const MOCK_REFERRAL_HISTORY = [
  { id: 1, name: "Sarah L.", joinedDate: "Mar 18, 2026", status: "Rewarded", reward: "S$20 credit" },
  { id: 2, name: "Marcus T.", joinedDate: "Mar 29, 2026", status: "Rewarded", reward: "S$20 credit" },
];

export default function ReferralPage() {
  return (
    <div>
      <motion.h2 initial="hidden" animate="visible" custom={0} variants={fadeUp} className="font-serif text-xl text-ink mb-2">
        Referral Program
      </motion.h2>
      <motion.p initial="hidden" animate="visible" custom={1} variants={fadeUp} className="text-sm text-muted mb-8">
        Share Yoga Sadhana with friends. You both earn rewards when they join.
      </motion.p>

      {/* Reward banner */}
      <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp} className="bg-accent-glow/20 border border-accent/20 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-deep">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Earn {REFERRAL_REWARD}</p>
          <p className="text-xs text-muted mt-0.5">
            Your friend also gets S$20 credit when they sign up using your code and book their first class.
          </p>
        </div>
      </motion.div>

      {/* Your code */}
      <motion.div initial="hidden" animate="visible" custom={3} variants={fadeUp} className="bg-card border border-border rounded-xl p-6 mb-4">
        <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Your Referral Code</p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 bg-warm border border-border rounded-lg px-5 py-3">
            <span className="font-mono text-2xl font-bold text-ink tracking-widest">{REFERRAL_CODE}</span>
          </div>
          <CopyButton value={REFERRAL_CODE} label="Copy code" />
        </div>
      </motion.div>

      {/* Shareable link */}
      <motion.div initial="hidden" animate="visible" custom={4} variants={fadeUp} className="bg-card border border-border rounded-xl p-6 mb-8">
        <p className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Shareable Link</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0 bg-warm border border-border rounded-lg px-4 py-2.5">
            <p className="text-sm font-mono text-muted truncate">{REFERRAL_LINK}</p>
          </div>
          <CopyButton value={REFERRAL_LINK} label="Copy link" />
        </div>
        <p className="text-xs text-muted mt-3">
          Share via WhatsApp, email, or social media. Your referral code will be auto-filled when friends open the link.
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div initial="hidden" animate="visible" custom={5} variants={fadeUp} className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5 text-center">
          <p className="text-3xl font-semibold text-ink mb-1">{REFERRALS_USED}</p>
          <p className="text-xs text-muted">Friends referred</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 text-center">
          <p className="text-3xl font-semibold text-ink mb-1">S${REFERRALS_USED * 20}</p>
          <p className="text-xs text-muted">Credits earned</p>
        </div>
      </motion.div>

      {/* History */}
      {MOCK_REFERRAL_HISTORY.length > 0 && (
        <motion.div initial="hidden" animate="visible" custom={6} variants={fadeUp}>
          <p className="text-sm font-medium text-ink mb-3">Referral history</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">Friend</th>
                  <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">Joined</th>
                  <th className="text-left text-xs text-muted font-medium uppercase tracking-wide px-5 py-3">Reward</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_REFERRAL_HISTORY.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-warm/50 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-ink">{r.name}</td>
                    <td className="px-5 py-3.5 text-sm text-muted">{r.joinedDate}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-medium text-sage bg-sage-light px-2.5 py-1 rounded-full">
                        {r.reward}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
