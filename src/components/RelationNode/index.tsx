import { type Node as FlowNode, Handle, type NodeProps, Position, useStoreApi } from "@xyflow/react";
import styled, { keyframes } from "styled-components";
import { TREE_GROWS_UP } from "@/features/genealogyDirection";

const appear = keyframes`
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
`;

type RelationNodeData = {
  color?: string | null;
  root?: boolean;
  layoutMode?: boolean;
  layoutStatus?: "persisted" | "dirty" | "rebased" | null;
  layoutCollision?: boolean;
  layoutSelected?: boolean;
  layoutNodeId?: string;
  onLayoutPointerDown?: (nodeId: string) => string[];
};
type RelationFlowNode = FlowNode<RelationNodeData, "relation">;

const Node = styled.div<{ $color: string | null; $growsUp: boolean }>`
  --ring: ${({ $color }) => $color ?? "#8a735a"};
  --fill: ${({ $color }) => ($color ? `color-mix(in srgb, ${$color} 14%, #f7f4ef)` : "#f7f4ef")};

  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--fill);
  border: 1.5px solid var(--ring);
  box-sizing: border-box;
  animation: ${appear} 0.25s ease-out both;

  &[data-layout-mode="true"] {
    animation: none;
    cursor: grab;
    touch-action: none;
  }

  &[data-layout-mode="true"]:active {
    cursor: grabbing;
  }

  &[data-layout-status="persisted"] {
    box-shadow: 0 0 0 5px rgba(61, 90, 76, 0.3);
  }

  &[data-layout-status="dirty"] {
    border-color: #b56b24;
    box-shadow: 0 0 0 6px rgba(181, 107, 36, 0.32);
  }

  &[data-layout-status="rebased"] {
    border-color: #756294;
    box-shadow: 0 0 0 6px rgba(117, 98, 148, 0.3);
  }

  &[data-layout-selected="true"] {
    outline: 3px solid #1c2a22;
    outline-offset: 8px;
  }

  &::before {
    content: "";
    position: absolute;
    left: 50%;
    ${({ $growsUp }) => ($growsUp ? "bottom: 100%;" : "top: 100%;")}
    width: 1.5px;
    height: 6px;
    background: var(--ring);
    opacity: 0.45;
    transform: translateX(-50%);
  }
`;

const handleStyle = {
  opacity: 0,
  width: 6,
  height: 6,
  border: "none",
  background: "transparent",
  minWidth: 0,
  minHeight: 0,
} as const;

export function RelationNode({ id, data }: NodeProps<RelationFlowNode>) {
  const store = useStoreApi();
  const growsUp = TREE_GROWS_UP;
  const childSide = growsUp ? Position.Top : Position.Bottom;
  const childStyle = growsUp
    ? { ...handleStyle, top: 0, left: "50%", transform: "translate(-50%, -50%)" }
    : { ...handleStyle, bottom: 0, left: "50%", transform: "translate(-50%, 50%)" };

  return (
    <Node
      title="Związek"
      $color={data.color ?? null}
      $growsUp={growsUp}
      data-layout-mode={data.layoutMode ? "true" : undefined}
      data-layout-status={data.layoutStatus ?? undefined}
      data-layout-selected={data.layoutSelected ? "true" : undefined}
      onPointerDownCapture={() => {
        const nodeIds = data.onLayoutPointerDown?.(data.layoutNodeId ?? id) ?? [];
        if (nodeIds.length > 0) store.getState().addSelectedNodes(nodeIds);
      }}
    >
      <Handle type="target" position={Position.Left} id="partner-first" style={{ ...handleStyle, left: 0, top: "50%", transform: "translate(-50%, -50%)" }} />
      <Handle type="target" position={Position.Right} id="partner-second" style={{ ...handleStyle, right: 0, top: "50%", transform: "translate(50%, -50%)" }} />
      <Handle type="source" position={childSide} id="child" style={childStyle} />
    </Node>
  );
}
