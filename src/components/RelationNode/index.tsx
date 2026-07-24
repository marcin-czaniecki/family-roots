import { Handle, Position } from "@xyflow/react";
import styled, { keyframes } from "styled-components";

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

const Node = styled.div`
  --ring: #8a735a;
  --fill: #f7f4ef;

  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fill);
  border: 1.5px solid var(--ring);
  box-sizing: border-box;
  animation: ${appear} 0.25s ease-out both;
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

export function RelationNode() {
  return (
    <Node title="Związek">
      <Handle type="target" position={Position.Left} id="partner-first" style={{ ...handleStyle, left: 0, top: "50%" }} />
      <Handle type="target" position={Position.Right} id="partner-second" style={{ ...handleStyle, right: 0, top: "50%" }} />
      <Handle type="source" position={Position.Bottom} id="child" style={{ ...handleStyle, bottom: 0, left: "50%" }} />
    </Node>
  );
}
