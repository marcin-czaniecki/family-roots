import { type Node as FlowNode, Handle, type NodeProps, Position } from "@xyflow/react";
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

type RelationNodeData = { color?: string | null; root?: boolean };
type RelationFlowNode = FlowNode<RelationNodeData, "relation">;

const Node = styled.div<{ $color: string | null; $growsUp: boolean }>`
  --ring: ${({ $color }) => $color ?? "#8a735a"};
  --fill: ${({ $color }) => ($color ? `color-mix(in srgb, ${$color} 14%, #f7f4ef)` : "#f7f4ef")};

  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fill);
  border: 1.5px solid var(--ring);
  box-sizing: border-box;
  animation: ${appear} 0.25s ease-out both;

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

export function RelationNode({ data }: NodeProps<RelationFlowNode>) {
  const growsUp = TREE_GROWS_UP;
  const childSide = growsUp ? Position.Top : Position.Bottom;
  const childStyle = growsUp
    ? { ...handleStyle, top: 0, left: "50%", transform: "translate(-50%, -50%)" }
    : { ...handleStyle, bottom: 0, left: "50%", transform: "translate(-50%, 50%)" };

  return (
    <Node title="Związek" $color={data.color ?? null} $growsUp={growsUp}>
      <Handle type="target" position={Position.Left} id="partner-first" style={{ ...handleStyle, left: 0, top: "50%", transform: "translate(-50%, -50%)" }} />
      <Handle type="target" position={Position.Right} id="partner-second" style={{ ...handleStyle, right: 0, top: "50%", transform: "translate(50%, -50%)" }} />
      <Handle type="source" position={childSide} id="child" style={childStyle} />
    </Node>
  );
}
