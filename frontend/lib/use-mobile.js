"use client";

import { useEffect, useState } from "react";

const MOBILE_BP = 768;

// Turbopack dev-mode emits "useIsMobile defined multiple times" when this module
// is imported — SWC inlines the export and clashes with the import binding.
// Investigated 2026-07-24: production build is clean, no runtime effect. Ignore.
export const useIsMobile = () => {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BP}px)`);
    setMobile(mq.matches);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
};
