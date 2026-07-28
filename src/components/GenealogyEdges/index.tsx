import { BaseEdge, type Edge, type EdgeProps, getStraightPath } from "@xyflow/react";
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
};

type DescentEdgeType = Edge<DescentEdgeData, "descent">;

/**
 * Classic genealogy descent: vertical trunk → sibling bar → to child.
 * Direct bar is farther from the child than union bar (toward the parents).
 */
export function DescentEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps<DescentEdgeType>) {
  const lane = data?.lane ?? "union";
  const offset = data?.barOffset ?? (lane === "direct" ? 88 : 40);
  // Bar sits between generations, on the parent side of the child card.
  const barY = TREE_GROWS_UP ? targetY + offset : targetY - offset;

  const path = `M ${sourceX},${sourceY} L ${sourceX},${barY} L ${targetX},${barY} L ${targetX},${targetY}`;

  return (
    <>
      <BaseEdge id={`${id}-halo`} path={path} style={{ stroke: "#f3efe8", strokeWidth: 6 }} />
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
    </>
  );
}
