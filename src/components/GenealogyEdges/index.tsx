import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getStraightPath, useReactFlow } from "@xyflow/react";
import { MoveVertical } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
import type { TreeLayoutPreset } from "@/entities/relation/types";
import { TREE_GROWS_UP } from "@/features/genealogyDirection";

const STROKE = "#8a735a";
const STROKE_WIDTH = 1.6;

/** Horizontal partner link: person ↔ union */
export function PartnerEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: STROKE,
        strokeWidth: STROKE_WIDTH,
        ...style,
      }}
    />
  );
}

export type DescentEdgeData = {
  /** "direct" = single parent, "union" = couple's child — different bars so lines never merge. */
  lane?: "union" | "direct";
  /** Distance of the shared horizontal bar from the child parent handle. */
  barOffset?: number;
  /** Effective layout inherited by the child branch. */
  layoutPreset?: TreeLayoutPreset;
  layoutMode?: boolean;
  layoutStatus?: "persisted" | "dirty" | "rebased" | null;
  onBendChange?: (edgeId: string, barOffset: number) => void;
  onBendCommit?: (edgeId: string, barOffset: number) => void;
};

type DescentEdgeType = Edge<DescentEdgeData, "descent">;

/**
 * Classic genealogy descent: vertical trunk → sibling bar → to child.
 * Direct bar is farther from the child than union bar (toward the parents).
 */
export function DescentEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data, selected }: EdgeProps<DescentEdgeType>) {
  const { screenToFlowPosition } = useReactFlow();
  const dragging = useRef(false);
  const lane = data?.lane ?? "union";
  const minimumOffset = 24;
  const maximumOffset = Math.max(minimumOffset, Math.abs(sourceY - targetY) - 24);
  const requestedOffset = data?.barOffset ?? (lane === "direct" ? 88 : 40);
  const offset = Math.min(maximumOffset, Math.max(minimumOffset, requestedOffset));
  const barY = TREE_GROWS_UP ? targetY + offset : targetY - offset;
  const bendX = (sourceX + targetX) / 2;
  const path = `M ${sourceX},${sourceY} L ${sourceX},${barY} L ${targetX},${barY} L ${targetX},${targetY}`;

  const offsetFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const rawOffset = TREE_GROWS_UP ? point.y - targetY : targetY - point.y;
    return Math.min(maximumOffset, Math.max(minimumOffset, rawOffset));
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    const nextOffset = offsetFromPointer(event);
    data?.onBendChange?.(id, nextOffset);
  };
  const finishDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const nextOffset = offsetFromPointer(event);
    data?.onBendChange?.(id, nextOffset);
    data?.onBendCommit?.(id, nextOffset);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    const visualDirection = event.key === "ArrowUp" ? -1 : 1;
    const offsetDirection = TREE_GROWS_UP ? visualDirection : -visualDirection;
    const nextOffset = Math.min(maximumOffset, Math.max(minimumOffset, offset + offsetDirection * 4));
    data?.onBendChange?.(id, nextOffset);
    data?.onBendCommit?.(id, nextOffset);
  };

  return (
    <>
      <BaseEdge id={`${id}-halo`} path={path} style={{ stroke: "#f3efe8", strokeWidth: selected ? 7 : 6 }} />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: STROKE,
          strokeWidth: selected ? 2.4 : STROKE_WIDTH,
          ...style,
        }}
      />
      {data?.layoutMode && selected ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan"
            data-edge-bend-handle="true"
            data-layout-status={data.layoutStatus ?? "automatic"}
            aria-label="Przesuń punkt zgięcia linii"
            title="Przesuń punkt zgięcia linii"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
            onKeyDown={handleKeyDown}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${bendX}px, ${barY}px)`,
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              border: "2px solid #3d5a4c",
              borderRadius: "50%",
              background: data.layoutStatus ? "#dce9df" : "#fff",
              color: "#263e32",
              boxShadow: "0 2px 8px rgba(28, 42, 34, 0.2)",
              cursor: "ns-resize",
              pointerEvents: "all",
              touchAction: "none",
              zIndex: 30,
            }}
          >
            <MoveVertical size={14} aria-hidden="true" />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
