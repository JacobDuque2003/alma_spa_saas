"use client";
import { useState, useEffect } from "react";

export function useGridTransition(navDirection, loading) {
  const [gridClass, setGridClass] = useState("");

  useEffect(() => {
    if (navDirection !== 0) {
      setGridClass(navDirection > 0 ? "alma-grid-exit-left" : "alma-grid-exit-right");
    }
  }, [navDirection]);

  useEffect(() => {
    if (!loading && navDirection !== 0) {
      setGridClass(navDirection > 0 ? "alma-grid-enter-left" : "alma-grid-enter-right");
    }
  }, [loading]);

  const onAnimationEnd = () => setGridClass("");

  return { gridClass, onAnimationEnd };
}
