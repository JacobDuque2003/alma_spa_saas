"use client";
import { useState, useEffect, useRef } from "react";

export function useAnimatedMount(isOpen, durationMs = 220) {
  const [phase, setPhase] = useState(isOpen ? "entered" : null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    if (isOpen) {
      setPhase("entering");
      timeoutRef.current = setTimeout(() => setPhase("entered"), 10);
      return () => clearTimeout(timeoutRef.current);
    }

    setPhase((current) => (current === null ? null : "exiting"));
    timeoutRef.current = setTimeout(() => setPhase(null), durationMs);
    return () => clearTimeout(timeoutRef.current);
  }, [isOpen, durationMs]);

  return { shouldRender: phase !== null, phase: phase || "exiting" };
}
