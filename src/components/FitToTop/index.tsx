import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

const INITIAL_ZOOM = 0.2;
const NODE_RETRY_FRAMES = 30;
const ROOT_VERTICAL_ANCHOR = 0.84;

/** Centers the initial viewport on the root relation or single-parent card at an overview zoom. */
export function FitToTop({ ready, rootId }: { ready: boolean; rootId: string | null }) {
  const { getNode, setViewport } = useReactFlow();

  useEffect(() => {
    if (!ready || !rootId) return;

    let frame = 0;
    let attempts = 0;
    let cancelled = false;

    const centerRoot = () => {
      if (cancelled) return;
      const root = getNode(rootId);
      if (!root) {
        attempts += 1;
        if (attempts < NODE_RETRY_FRAMES) frame = requestAnimationFrame(centerRoot);
        return;
      }

      const width = root.measured?.width ?? root.width ?? (root.type === "person" ? 360 : 36);
      const height = root.measured?.height ?? root.height ?? (root.type === "person" ? 240 : 14);
      const flow = document.querySelector<HTMLElement>(".genealogy-flow");
      const viewportWidth = flow?.clientWidth ?? window.innerWidth;
      const viewportHeight = flow?.clientHeight ?? window.innerHeight;
      const zoom = INITIAL_ZOOM;
      const centerX = root.position.x + width / 2;
      const centerY = root.position.y + height / 2;

      setViewport(
        {
          x: viewportWidth / 2 - centerX * zoom,
          y: viewportHeight * ROOT_VERTICAL_ANCHOR - centerY * zoom,
          zoom,
        },
        { duration: 0 },
      );
    };

    frame = requestAnimationFrame(centerRoot);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [ready, rootId, getNode, setViewport]);

  return null;
}
