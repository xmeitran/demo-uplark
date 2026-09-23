"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Home, ArrowLeft, MapPin } from "lucide-react";

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

        <h1 className="text-xl font-bold text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist yet or has moved.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link href="/">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              <Home className="w-4 h-4" />
              Dashboard
            </motion.button>
          </Link>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => window.history.back()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
