import { Handle, Position } from "@xyflow/react";
import styled, { css, keyframes } from "styled-components";
import type { Person } from "@/entities/person/types";
import { TREE_GROWS_UP } from "@/features/genealogyDirection";

type Sex = boolean;

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(var(--enter-y, 4px));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const Card = styled.article<{ $sex: Sex; $growsUp: boolean }>`
  --ink: #1c2a22;
  --muted: #5c6b62;
  --paper: #f7f4ef;
  --line: #c5b8a4;
  --accent: ${({ $sex }) => ($sex ? "#3d5a4c" : "#6b4f3a")};
  --photo-fallbacks: #dfe6e1;
  --enter-y: ${({ $growsUp }) => ($growsUp ? "-4px" : "4px")};

  box-sizing: border-box;
  width: 168px;
  height: 268px;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  background: var(--paper);
  border: 1px solid var(--line);
  ${({ $growsUp }) =>
    $growsUp
      ? css`
          border-bottom: 3px solid var(--accent);
        `
      : css`
          border-top: 3px solid var(--accent);
        `}
  box-shadow: 0 1px 0 rgba(28, 42, 34, 0.06);
  animation: ${fadeIn} 0.35s ease-out both;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    transform: translateY(${({ $growsUp }) => ($growsUp ? "2px" : "-2px")});
    box-shadow: 0 6px 16px rgba(28, 42, 34, 0.1);
    border-color: var(--accent);
  }
`;

const Photo = styled.div<{ $hasImage: boolean; $growsUp: boolean }>`
  position: relative;
  width: 100%;
  height: 196px;
  flex: none;
  background: linear-gradient(160deg, #e8eee9 0%, var(--photo-fallbacks) 100%);
  overflow: hidden;

  ${({ $hasImage }) =>
    !$hasImage &&
    css`
      &::after {
        content: "";
        position: absolute;
        inset: 18% 22%;
        border: 1px solid rgba(28, 42, 34, 0.12);
        border-radius: 50% 50% 46% 46%;
        background: rgba(255, 255, 255, 0.35);
      }
    `}

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: ${({ $growsUp }) => ($growsUp ? "center bottom" : "center top")};
    display: block;
  }
`;

const Body = styled.div<{ $growsUp: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: ${({ $growsUp }) => ($growsUp ? "column-reverse" : "column")};
  gap: 0.2rem;
  padding: 0.55rem 0.65rem 0.7rem;
  text-align: center;
`;

const Name = styled.h2`
  margin: 0;
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.25;
  color: var(--ink);
  letter-spacing: 0.01em;
`;

const Dates = styled.p`
  margin: 0;
  font-size: 0.62rem;
  line-height: 1.3;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
`;

const Place = styled.p`
  margin: 0.15rem 0 0;
  font-size: 0.55rem;
  line-height: 1.2;
  color: var(--muted);
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const handleStyle = {
  opacity: 0,
  width: 8,
  height: 8,
  border: "none",
  background: "transparent",
} as const;

type PartialDate = Record<"day" | "month" | "year", number | null> | null;

function formatPartialDate(date: PartialDate): string {
  if (!date?.year) return "";
  const day = date.day ? `${date.day}.` : "";
  const month = date.month ? `${date.month}.` : "";
  return `${day}${month}${date.year}`;
}

function formatLifespan(person: Person): string {
  const birth = formatPartialDate(person.birth);
  const death = formatPartialDate(person.death);
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `* ${birth}`;
  if (death) return `† ${death}`;
  return "";
}

export function PersonNode({ data: person }: { data: Person }) {
  const lifespan = formatLifespan(person);
  const place = person.birthPlace || person.deathPlace;
  const growsUp = TREE_GROWS_UP;
  const parentSide = growsUp ? Position.Bottom : Position.Top;
  const childSide = growsUp ? Position.Top : Position.Bottom;

  return (
    <Card $sex={person.sex} $growsUp={growsUp}>
      <Handle type="target" position={parentSide} id="parent" style={handleStyle} />
      <Handle type="source" position={childSide} id="child" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="partner-first" style={handleStyle} />
      <Handle type="source" position={Position.Left} id="partner-second" style={handleStyle} />

      <Photo $hasImage={Boolean(person.photoUrl)} $growsUp={growsUp}>
        {person.photoUrl ? <img src={person.photoUrl} alt={`${person.firstName} ${person.lastName}`} draggable={false} /> : null}
      </Photo>

      <Body $growsUp={growsUp}>
        <Name>
          {person.firstName} {person.lastName}
        </Name>
        {lifespan ? <Dates>{lifespan}</Dates> : null}
        {place ? <Place>{place}</Place> : null}
      </Body>
    </Card>
  );
}
