import { BaseEdge, type Edge, type EdgeProps, getStraightPath } from "@xyflow/react";

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
  /** "direct" = single parent (higher bar), "union" = couple's child (lower bar). */
  lane?: "union" | "direct";
};

type DescentEdgeType = Edge<DescentEdgeData, "descent">;

/**
 * Classic genealogy descent: vertical trunk → sibling bar → drop to child.
 * Direct (single-parent) bar sits ABOVE the union children's bar so lines never merge.
 */
export function DescentEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps<DescentEdgeType>) {
  const lane = data?.lane ?? "union";
  // Smaller offset from child = bar lower. Direct must be above union.
  const barY = targetY - (lane === "direct" ? 88 : 40);

  const path = `M ${sourceX},${sourceY} L ${sourceX},${barY} L ${targetX},${barY} L ${targetX},${targetY}`;

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
