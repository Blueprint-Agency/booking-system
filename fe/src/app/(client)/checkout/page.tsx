"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatCurrency } from "@/lib/utils";

const inputClass =
  "w-full bg-warm border border-border rounded-md px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-accent/30 focus:border-accent outline-none transition placeholder:text-muted";

export default function CheckoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const itemName = "Standard Pack (10 sessions)";
  const quantity = 1;
  const price = 160;
  const total = price * quantity;

  function handlePay() {
    setLoading(true);
    setTimeout(() => {
      router.push("/booking/confirmation");
    }, 1500);
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-12 sm:py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-4xl"
      >
        <h1 className="font-serif text-3xl text-ink mb-8">Checkout</h1>

        <div className="grid gap-8 lg:grid-cols-5">
          {/* Order Summary */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-2"
          >
            <div className="rounded-lg border border-border bg-card p-6 shadow-soft">
              <h2 className="font-serif text-xl text-ink mb-5">
                Order Summary
              </h2>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{itemName}</p>
                    <p className="text-xs text-muted mt-0.5">
                      Qty: {quantity}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-ink whitespace-nowrap">
                    {formatCurrency(price)}
                  </p>
                </div>
              </div>

              <div className="my-5 border-t border-border" />

              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Total</p>
                <p className="text-lg font-semibold text-ink">
                  {formatCurrency(total)}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Payment Form */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="lg:col-span-3"
          >
            <div className="rounded-lg border border-border bg-card p-6 shadow-soft">
              <h2 className="font-serif text-xl text-ink mb-5">
                Payment Details
              </h2>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePay();
                }}
                className="space-y-4"
              >
                {/* Card Number */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">
                    Card number
                  </label>
                  <input
                    type="text"
                    defaultValue="4242 4242 4242 4242"
                    className={inputClass}
                    readOnly
                  />
                </div>

                {/* Expiry + CVC */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">
                      Expiry
                    </label>
                    <input
                      type="text"
                      defaultValue="12/28"
                      className={inputClass}
                      readOnly
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">
                      CVC
                    </label>
                    <input
                      type="text"
                      defaultValue="123"
                      className={inputClass}
                      readOnly
                    />
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">
                    Name on card
                  </label>
                  <input
                    type="text"
                    placeholder="Full name"
                    className={inputClass}
                    defaultValue="Sarah Chen"
                  />
                </div>

                {/* Pay Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    "w-full mt-2 rounded-md py-3.5 text-sm font-semibold text-white transition-all",
                    loading
                      ? "bg-accent/70 cursor-not-allowed"
                      : "bg-accent hover:bg-accent-deep active:scale-[0.98] shadow-soft hover:shadow-hover"
                  )}
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    `Pay ${formatCurrency(total)}`
                  )}
                </button>

                {/* Stripe branding */}
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted pt-1">
                  <Lock className="h-3 w-3" />
                  Secured by Stripe
                </p>
              </form>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
