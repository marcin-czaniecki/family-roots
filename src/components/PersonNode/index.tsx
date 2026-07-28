import { Handle, Position, useStoreApi } from "@xyflow/react";
import styled, { css } from "styled-components";
import type { Person } from "@/entities/person/types";
import { TREE_GROWS_UP } from "@/features/genealogyDirection";

type Sex = boolean;

type PersonNodeData = Person & {
  editMode?: boolean;
  onEdit?: (person: Person) => void;
  showBirthSurname?: boolean;
  themeColor?: string | null;
  layoutMode?: boolean;
  layoutStatus?: "persisted" | "dirty" | "rebased" | null;
  layoutCollision?: boolean;
  layoutSelected?: boolean;
  layoutNodeId?: string;
  onLayoutPointerDown?: (nodeId: string) => string[];
};

const Card = styled.article<{ $sex: Sex; $growsUp: boolean; $themeColor: string | null }>`
  --ink: ${({ $themeColor }) => ($themeColor ? `color-mix(in srgb, ${$themeColor} 22%, #1c2a22)` : "#1c2a22")};
  --muted: ${({ $themeColor }) => ($themeColor ? `color-mix(in srgb, ${$themeColor} 28%, #5c6b62)` : "#5c6b62")};
  --paper: ${({ $themeColor }) => ($themeColor ? `color-mix(in srgb, ${$themeColor} 11%, #f7f4ef)` : "#f7f4ef")};
  --line: ${({ $themeColor }) => ($themeColor ? `color-mix(in srgb, ${$themeColor} 48%, #c5b8a4)` : "#c5b8a4")};
  --accent: ${({ $sex, $themeColor }) => $themeColor ?? ($sex ? "#3d5a4c" : "#6b4f3a")};

  --enter-y: ${({ $growsUp }) => ($growsUp ? "-4px" : "4px")};

  position: relative;
  box-sizing: border-box;
  width: 360px;
  height: 240px;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: visible;
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
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &:hover,
  &:focus-visible {
    z-index: 20;
    transform: translateY(${({ $growsUp }) => ($growsUp ? "2px" : "-2px")});
    box-shadow: 0 6px 16px rgba(28, 42, 34, 0.1);
    border-color: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  &[data-layout-mode="true"] {
    cursor: grab;
    touch-action: none;
  }

  &[data-layout-mode="true"]:active {
    cursor: grabbing;
  }

  &[data-layout-status="persisted"] {
    box-shadow:
      0 0 0 3px rgba(61, 90, 76, 0.28),
      0 1px 0 rgba(28, 42, 34, 0.06);
  }

  &[data-layout-status="dirty"] {
    border-color: #b56b24;
    box-shadow:
      0 0 0 3px rgba(181, 107, 36, 0.3),
      0 1px 0 rgba(28, 42, 34, 0.06);
  }

  &[data-layout-status="rebased"] {
    border-color: #756294;
    box-shadow:
      0 0 0 3px rgba(117, 98, 148, 0.28),
      0 1px 0 rgba(28, 42, 34, 0.06);
  }

  &[data-layout-selected="true"] {
    outline: 3px solid #1c2a22;
    outline-offset: 5px;
  }

  &[data-layout-collision="true"] {
    border-color: #a33b32;
    box-shadow:
      0 0 0 5px rgba(163, 59, 50, 0.3),
      0 1px 0 rgba(28, 42, 34, 0.06);
  }
`;

const Body = styled.div<{ $growsUp: boolean }>`
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: ${({ $growsUp }) => ($growsUp ? "column-reverse" : "column")};
  justify-content: center;
  gap: 0.75rem;
  padding: 1.25rem;
  overflow: hidden;
  text-align: center;
`;

const Name = styled.h2`
  margin: 0;
  font-size: 2.35rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--ink);
  overflow-wrap: anywhere;
`;
const BirthSurname = styled.p`
  margin: -0.35rem 0 0;
  color: var(--accent);
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
`;

const Dates = styled.p`
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.3;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
`;

const Place = styled.p`
  margin: 0.15rem 0 0;
  font-size: 1.1rem;
  line-height: 1.2;
  color: var(--muted);
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Biography = styled.aside<{ $growsUp: boolean }>`
  position: absolute;
  z-index: 30;
  left: 50%;
  ${({ $growsUp }) =>
    $growsUp
      ? css`
          top: calc(100% + 10px);
          transform: translate(-50%, -4px);
        `
      : css`
          bottom: calc(100% + 10px);
          transform: translate(-50%, 4px);
        `}
  width: 420px;
  max-width: calc(100vw - 2rem);
  max-height: 280px;
  box-sizing: border-box;
  padding: 0.75rem 0.8rem;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 8px 24px rgba(28, 42, 34, 0.18);
  font-size: 1.1rem;
  line-height: 1.45;
  text-align: left;
  white-space: pre-line;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    visibility 0.15s ease;

  &::before {
    content: "";
    position: absolute;
    left: 50%;
    width: 14px;
    height: 14px;
    background: var(--paper);
    ${({ $growsUp }) =>
      $growsUp
        ? css`
            top: -8px;
            border-top: 1px solid var(--line);
            border-left: 1px solid var(--line);
          `
        : css`
            bottom: -8px;
            border-right: 1px solid var(--line);
            border-bottom: 1px solid var(--line);
          `}
    transform: translateX(-50%) rotate(45deg);
  }

  ${Card}:hover &,
  ${Card}:focus-visible & {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }
`;
const EditButton = styled.button`
  position: absolute;
  z-index: 10;
  top: 0.65rem;
  right: 0.65rem;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--accent);
  font: inherit;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(28, 42, 34, 0.14);

  &:hover,
  &:focus-visible {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
    outline: none;
  }
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

export function PersonNode({ data: person }: { data: PersonNodeData }) {
  const store = useStoreApi();
  const lifespan = formatLifespan(person);
  const place = person.birthPlace || person.deathPlace;
  const biography = person.biography?.trim();
  const birthSurname = person.birthSurname?.trim();
  const biographyId = `person-biography-${person.id}`;
  const growsUp = TREE_GROWS_UP;
  const parentSide = growsUp ? Position.Bottom : Position.Top;
  const childSide = growsUp ? Position.Top : Position.Bottom;

  return (
    <Card
      $sex={person.sex}
      $growsUp={growsUp}
      $themeColor={person.themeColor ?? null}
      tabIndex={biography ? 0 : undefined}
      aria-describedby={biography ? biographyId : undefined}
      data-layout-mode={person.layoutMode ? "true" : undefined}
      data-layout-status={person.layoutStatus ?? undefined}
      data-layout-selected={person.layoutSelected ? "true" : undefined}
      data-layout-collision={person.layoutCollision ? "true" : undefined}
      onPointerDownCapture={() => {
        if (!person.layoutNodeId) return;
        const nodeIds = person.onLayoutPointerDown?.(person.layoutNodeId) ?? [];
        if (nodeIds.length > 0) store.getState().addSelectedNodes(nodeIds);
      }}
    >
      <Handle type="target" position={parentSide} id="parent" style={handleStyle} />
      <Handle type="source" position={childSide} id="child" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="partner-first" style={handleStyle} />
      <Handle type="source" position={Position.Left} id="partner-second" style={handleStyle} />

      {person.editMode && person.onEdit ? (
        <EditButton
          type="button"
          className="nodrag nopan"
          aria-label={`Edytuj ${person.firstName} ${person.lastName}`}
          title="Edytuj osobę"
          onClick={(event) => {
            event.stopPropagation();
            person.onEdit?.(person);
          }}
        >
          ✎
        </EditButton>
      ) : null}

      <Body $growsUp={growsUp}>
        <Name>
          {person.firstName} {person.lastName}
        </Name>
        {person.showBirthSurname && birthSurname ? <BirthSurname>Z domu {birthSurname}</BirthSurname> : null}
        {lifespan ? <Dates>{lifespan}</Dates> : null}
        {place ? <Place>{place}</Place> : null}
      </Body>
      {biography ? (
        <Biography id={biographyId} role="tooltip" $growsUp={growsUp}>
          {biography}
        </Biography>
      ) : null}
    </Card>
  );
}
