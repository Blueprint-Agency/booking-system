"use client";

import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function MyQRCode() {
  return (
    <div>
      <motion.h2
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="font-serif text-xl text-ink mb-6"
      >
        My QR Code
      </motion.h2>

      <motion.div
        initial="hidden"
        animate="visible"
        custom={1}
        variants={fadeUp}
        className="bg-card border border-border rounded-xl p-8 sm:p-12 max-w-sm mx-auto text-center"
      >
        {/* QR Code */}
        <div className="inline-flex p-6 bg-white rounded-lg shadow-soft mb-6">
          <QRCodeSVG
            value="CLIENT-cli-1"
            size={200}
            level="M"
            bgColor="#ffffff"
            fgColor="#1a1a2e"
          />
        </div>

        {/* Instructions */}
        <p className="text-sm text-ink font-medium mb-2">
          Show this QR code at the front desk for check-in
        </p>

        {/* Tip */}
        <p className="text-xs text-muted">
          Tip: Increase your screen brightness for faster scanning
        </p>
      </motion.div>
    </div>
  );
}
