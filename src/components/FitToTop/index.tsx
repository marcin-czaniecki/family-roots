import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

/** Centers the initial viewport on the root relation or single-parent card. */
export function FitToTop({ ready }: { ready: boolean }) {
  const { getNodes, setCenter } = useReactFlow();

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const root = getNodes().find((node) => node.data.root === true);
      if (!root) return;
      const width = root.measured?.width ?? root.width ?? (root.type === "person" ? 360 : 14);
      const height = root.measured?.height ?? root.height ?? (root.type === "person" ? 240 : 14);
      setCenter(root.position.x + width / 2, root.position.y + height / 2, { duration: 0, zoom: 0.82 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, getNodes, setCenter]);

  return null;
}
