import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

const MAX_INITIAL_ZOOM = 0.54;
const MIN_INITIAL_ZOOM = 0.34;
const ROOT_ROW_SAFE_WIDTH = 840;
const VIEWPORT_SIDE_PADDING = 40;

function initialTreeZoom() {
  const widthLimitedZoom = (window.innerWidth - VIEWPORT_SIDE_PADDING) / ROOT_ROW_SAFE_WIDTH;
  return Math.max(MIN_INITIAL_ZOOM, Math.min(MAX_INITIAL_ZOOM, widthLimitedZoom));
}

/** Centers the initial viewport on the root relation or single-parent card at a readable overview zoom. */
export function FitToTop({ ready }: { ready: boolean }) {
  const { getNodes, setCenter } = useReactFlow();

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const root = getNodes().find((node) => node.data.root === true);
      if (!root) return;
      const width = root.measured?.width ?? root.width ?? (root.type === "person" ? 360 : 36);
      const height = root.measured?.height ?? root.height ?? (root.type === "person" ? 240 : 14);
      setCenter(root.position.x + width / 2, root.position.y + height / 2, { duration: 0, zoom: initialTreeZoom() });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, getNodes, setCenter]);

  return null;
}
