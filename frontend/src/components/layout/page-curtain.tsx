"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const EASE: [number, number, number, number] = [0.76, 0, 0.24, 1];

export function PageCurtain() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [prevPath, setPrevPath] = useState(pathname);
  const [ticket, setTicket] = useState(0);
  const [phase, setPhase] = useState<"idle" | "cover" | "reveal">("idle");

  if (pathname !== prevPath) {
    setPrevPath(pathname);
    if (!reduce) {
      setTicket((current) => current + 1);
      setPhase("cover");
    }
  }

  useEffect(() => {
    if (ticket === 0) return;
    const cover = window.setTimeout(() => setPhase("reveal"), 420);
    const done = window.setTimeout(() => setPhase("idle"), 900);
    return () => {
      window.clearTimeout(cover);
      window.clearTimeout(done);
    };
  }, [ticket]);

  const open = phase === "cover";

  return (
    <AnimatePresence>
      {phase !== "idle" ? (
        <motion.div
          key={`mmh-page-curtain-${ticket}`}
          className="pointer-events-none fixed inset-0 z-[85] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          aria-hidden
        >
          <motion.div
            className="absolute inset-0 bg-brand"
            initial={{ y: "-100%" }}
            animate={{ y: open ? "0%" : "100%" }}
            transition={{ duration: 0.55, ease: EASE }}
          />
          <motion.p
            className="absolute inset-0 z-10 flex items-center justify-center text-sm font-semibold tracking-[0.5em] text-gold"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.2, delay: open ? 0.2 : 0 }}
          >
            MMH
          </motion.p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
