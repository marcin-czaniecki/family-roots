import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

/** Anchors the viewport to the top-left of the laid-out tree (no centering). */
export function FitToTop({ ready }: { ready: boolean }) {
  const { getNodes, setViewport } = useReactFlow();

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const current = getNodes();
      if (current.length === 0) return;
      const minX = Math.min(...current.map((n) => n.position.x));
      const minY = Math.min(...current.map((n) => n.position.y));
      setViewport({ x: -minX + 64, y: -minY + 40, zoom: 0.82 }, { duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, getNodes, setViewport]);

  return null;
}
