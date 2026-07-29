"use client";
import { useState, useEffect, useRef } from "react";

export function useAnimatedMount(isOpen, durationMs = 220) {
  const [phase, setPhase] = useState(isOpen ? "entered" : null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPhase("entering");
      const t = setTimeout(() => setPhase("entered"), 10);
      return () => clearTimeout(t);
    } else if (phase) {
      setPhase("exiting");
      timeoutRef.current = setTimeout(() => setPhase(null), durationMs);
      return () => clearTimeout(timeoutRef.current);
    }
  }, [isOpen]);

  return { shouldRender: phase !== null, phase: phase || "exiting" };
}
