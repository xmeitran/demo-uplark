"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin } from "lucide-react";

// Mirrors PageHeader's back link (this page renders outside the app shell, so it cannot use PageHeader's layout).
const BACK_LINK_CLASS = "inline-flex items-center gap-1.5 !text-xs !font-semibold !text-muted-foreground transition-colors hover:!text-foreground";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ backgroundColor: "var(--color-background)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 280 }}
        className="text-center max-w-sm"
      >
        {/* 404 number */}
        <p
          className="text-8xl font-black font-mono tabular-nums mb-4 select-none"
          style={{
            background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          404
        </p>

        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-6 h-6 text-muted-foreground" />
        </div>

        <h1 className="text-xl font-bold text-foreground mb-2">Không tìm thấy trang</h1>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          Trang bạn tìm chưa tồn tại hoặc đã được chuyển đi.
        </p>

        {/* Same look as the PageHeader back link; "Quay lại trang trước" keeps the browser-history behaviour. */}
        <div className="flex flex-col items-center gap-3">
          <Link href="/" aria-label="Quay lại Dashboard" className={BACK_LINK_CLASS}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Quay lại Dashboard
          </Link>
          <button type="button" onClick={() => window.history.back()} className={BACK_LINK_CLASS}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Quay lại trang trước
          </button>
        </div>
      </motion.div>
    </div>
  );
}
