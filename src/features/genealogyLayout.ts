import type { Edge, EdgeTypes, Node } from "@xyflow/react";
import { DescentEdge, type DescentEdgeData, PartnerEdge } from "@/components/GenealogyEdges";
import { PersonNode } from "@/components/PersonNode";
import { RelationNode } from "@/components/RelationNode";
import { getPerson } from "@/entities/person/getPerson";
import type { Person } from "@/entities/person/types";
import { childrenOf, isParent, isPartner, partnersOf, sideOfKid } from "@/entities/relation/helpers";
import type { ParentRelation, PartnerRelation, Relation, TreeLayoutPreset } from "@/entities/relation/types";
import { TREE_GROWS_UP } from "./genealogyDirection";

export const nodeTypes = {
  person: PersonNode,
  relation: RelationNode,
};

export const edgeTypes = {
  partner: PartnerEdge,
  descent: DescentEdge,
} satisfies EdgeTypes;

type PersonNodeData = Person & Record<string, unknown>;
type PersonFlowNode = Node<PersonNodeData, "person">;

type PersonResolver = (id: string) => Promise<Person>;

export const PERSON_W = 360;
export const PERSON_H = 240;
export const RELATION_SIZE = 36;
export const DEFAULT_TREE_LAYOUT_PRESET: TreeLayoutPreset = "compact";
export const TREE_LAYOUT_PRESET_OPTIONS: ReadonlyArray<{ value: TreeLayoutPreset; label: string; description: string }> = [
  { value: "compact", label: "Zwarty", description: "Najmniejsze bezpieczne odstępy między gałęziami." },
  { value: "balanced", label: "Zrównoważony", description: "Odstępy odpowiadające poprzedniemu układowi." },
  { value: "spacious", label: "Przestronny", description: "Więcej miejsca dla rozbudowanych linii." },
];
const GEN_H = 400;
const GEN_STEP = TREE_GROWS_UP ? -GEN_H : GEN_H;

type LayoutRules = {
  siblingGap: number;
  coupleGap: number;
  multiPartnerGap: number;
};

const LAYOUT_RULES: Record<TreeLayoutPreset, LayoutRules> = {
  compact: { siblingGap: 24, coupleGap: 28, multiPartnerGap: 48 },
  balanced: { siblingGap: 64, coupleGap: 40, multiPartnerGap: 96 },
  spacious: { siblingGap: 96, coupleGap: 56, multiPartnerGap: 144 },
};

function rulesFor(preset: TreeLayoutPreset): LayoutRules {
  return LAYOUT_RULES[preset];
}

function presetForRelation(relation: Relation, inheritedPreset: TreeLayoutPreset): TreeLayoutPreset {
  return relation.layoutPreset ?? inheritedPreset;
}

type LayoutMetrics = {
  /** Total width reserved for this person and all attached partners/kids. */
  width: number;
  /** Person card left edge relative to the unit's left edge. */
  personOffsetX: number;
};

type PartnershipLayoutMetrics = {
  /** Total width reserved for this partnership and all its descendants. */
  width: number;
  /** Relation center X relative to the block's left edge. */
  centerOffsetX: number;
  /** Left parent card X relative to the block's left edge. */
  leftPersonOffsetX: number;
};

type SidePlan = {
  partnerRel: PartnerRelation;
  side: "left" | "right";
  /** Inner edge X in person-local coords (person left edge = 0). */
  innerEdgeX: number;
};

type KidCenterBias = "center" | "left" | "right";

function birthRank(person: Person): number {
  const y = person.birth?.year ?? 9999;
  const m = person.birth?.month ?? 12;
  const d = person.birth?.day ?? 31;
  return y * 10000 + m * 100 + d;
}

function getPersonNode(id: string, person: Person, position: { x: number; y: number }, themeColor: string | null = null): PersonFlowNode {
  return {
    id,
    type: "person",
    position,
    data: { ...person, themeColor } as PersonNodeData,
    draggable: true,
  };
}

function otherPartnerId(partnerRel: PartnerRelation, personId: string): string | null {
  if (partnerRel.first.id === personId) return partnerRel.second?.id ?? null;
  if (partnerRel.second?.id === personId) return partnerRel.first.id;
  return null;
}

/**
 * Bounding box of one side-partnership in coordinates where the shared person's
 * left edge is at 0. Includes partner card and children (kids may overhang both ways).
 */
function sidePartnershipBounds(
  relations: Relation[],
  partnerRel: PartnerRelation,
  sharedPersonId: string,
  side: "left" | "right",
  innerEdgeX: number,
  inheritedPreset: TreeLayoutPreset,
): { minX: number; maxX: number } {
  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const otherId = otherPartnerId(partnerRel, sharedPersonId);
  const leftParentId = side === "right" ? sharedPersonId : (otherId ?? sharedPersonId);
  const rightParentId = side === "right" ? otherId : otherId ? sharedPersonId : null;
  const { leftW, centerW, rightW } = measureKidGroupWidths(relations, partnerRel, leftParentId, rightParentId, preset);
  const hasKids = leftW > 0 || centerW > 0 || rightW > 0;
  const unionX = side === "right" ? innerEdgeX + rules.coupleGap / 2 : innerEdgeX - rules.coupleGap / 2;

  if (side === "right") {
    const partnerLeft = otherId ? innerEdgeX + rules.coupleGap : innerEdgeX;
    const partnerRight = otherId ? partnerLeft + PERSON_W : innerEdgeX;
    if (!hasKids) return { minX: Math.min(innerEdgeX, partnerLeft), maxX: partnerRight };
    const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(otherId), rules.coupleGap, rules.siblingGap, "right");
    return {
      minX: Math.min(innerEdgeX, partnerLeft, unionX + starts.minX),
      maxX: Math.max(partnerRight, unionX + starts.maxX),
    };
  }

  const partnerLeft = otherId ? innerEdgeX - rules.coupleGap - PERSON_W : innerEdgeX;
  const partnerRight = otherId ? partnerLeft + PERSON_W : innerEdgeX;
  if (!hasKids) return { minX: partnerLeft, maxX: Math.max(innerEdgeX, partnerRight) };
  const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(rightParentId), rules.coupleGap, rules.siblingGap, "left");
  return {
    minX: Math.min(partnerLeft, unionX + starts.minX),
    maxX: Math.max(innerEdgeX, partnerRight, unionX + starts.maxX),
  };
}

/** Builds side plans + bounding box for multi-partner layout (person-local, person at 0). */
function planMultiPartnerLayout(
  relations: Relation[],
  personId: string,
  partnerships: PartnerRelation[],
  inheritedPreset: TreeLayoutPreset,
): { sides: SidePlan[]; minX: number; maxX: number } {
  const sides: SidePlan[] = [];
  const rules = rulesFor(inheritedPreset);
  let minX = 0;
  let maxX = PERSON_W;

  let rightBoundary = PERSON_W;
  let hasRightSide = false;
  for (let i = 0; i < partnerships.length; i += 2) {
    const partnerRel = partnerships[i];
    if (!partnerRel) continue;
    const baseBounds = sidePartnershipBounds(relations, partnerRel, personId, "right", 0, inheritedPreset);
    const rightInner = hasRightSide ? rightBoundary + rules.multiPartnerGap - baseBounds.minX : PERSON_W;
    sides.push({ partnerRel, side: "right", innerEdgeX: rightInner });
    const bounds = sidePartnershipBounds(relations, partnerRel, personId, "right", rightInner, inheritedPreset);
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    rightBoundary = Math.max(rightBoundary, bounds.maxX);
    hasRightSide = true;
  }

  let leftBoundary = 0;
  let hasLeftSide = false;
  for (let i = 1; i < partnerships.length; i += 2) {
    const partnerRel = partnerships[i];
    if (!partnerRel) continue;
    const baseBounds = sidePartnershipBounds(relations, partnerRel, personId, "left", 0, inheritedPreset);
    const innerEdgeX = hasLeftSide ? leftBoundary - rules.multiPartnerGap - baseBounds.maxX : 0;
    sides.push({ partnerRel, side: "left", innerEdgeX });
    const bounds = sidePartnershipBounds(relations, partnerRel, personId, "left", innerEdgeX, inheritedPreset);
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    leftBoundary = Math.min(leftBoundary, bounds.minX);
    hasLeftSide = true;
  }

  return { sides, minX, maxX };
}

/**
 * Kids group starts relative to couple center (0), clearing parent cards so
 * children never sit under a partner.
 */
function kidsGroupStarts(
  leftW: number,
  centerW: number,
  rightW: number,
  hasRightParent: boolean,
  coupleGap: number,
  siblingGap: number,
  centerBias: KidCenterBias = "center",
): { leftStart: number; centerStart: number; rightStart: number; minX: number; maxX: number } {
  const leftParentLeft = -(coupleGap / 2 + PERSON_W);
  const rightParentRight = hasRightParent ? coupleGap / 2 + PERSON_W : PERSON_W / 2;

  let centerStart = -centerW / 2;
  let centerEnd = centerW / 2;

  if (centerW > 0 && centerBias === "left") {
    centerEnd = leftParentLeft - siblingGap;
    centerStart = centerEnd - centerW;
  }

  if (centerW > 0 && centerBias === "right") {
    centerStart = rightParentRight + siblingGap;
    centerEnd = centerStart + centerW;
  }

  let leftEnd = centerW > 0 && centerBias !== "right" ? centerStart - siblingGap : leftParentLeft - siblingGap;
  leftEnd = Math.min(leftEnd, leftParentLeft - siblingGap);
  const leftStart = leftW > 0 ? leftEnd - leftW : 0;

  let rightStart = centerW > 0 && centerBias !== "left" ? centerEnd + siblingGap : rightParentRight + siblingGap;
  rightStart = Math.max(rightStart, rightParentRight + siblingGap);

  const minX = Math.min(leftW > 0 ? leftStart : 0, centerW > 0 ? centerStart : 0, leftParentLeft);
  const maxX = Math.max(rightW > 0 ? rightStart + rightW : 0, centerW > 0 ? centerEnd : 0, rightParentRight);

  return { leftStart, centerStart, rightStart, minX, maxX };
}

function measureKidGroupWidths(
  relations: Relation[],
  partnerRel: PartnerRelation,
  leftParentId: string,
  rightParentId: string | null,
  inheritedPreset: TreeLayoutPreset,
): { leftW: number; centerW: number; rightW: number } {
  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const kids = childrenOf(relations, partnerRel);
  const widths = { left: [] as number[], center: [] as number[], right: [] as number[] };

  for (const child of kids) {
    const childPreset = presetForRelation(child, preset);
    const width = subtreeWidth(relations, child.person.id, partnerRel.id, new Set(), childPreset);
    widths[sideOfKid(child, leftParentId, rightParentId)].push(width);
  }

  const sum = (list: number[]) => (list.length === 0 ? 0 : list.reduce((total, width) => total + width, 0) + rules.siblingGap * (list.length - 1));
  return { leftW: sum(widths.left), centerW: sum(widths.center), rightW: sum(widths.right) };
}

function partnershipLayoutMetrics(
  relations: Relation[],
  partnerRel: PartnerRelation,
  leftParentId?: string,
  rightParentId?: string | null,
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
  centerBias: KidCenterBias = "center",
): PartnershipLayoutMetrics {
  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const rightId = rightParentId !== undefined ? rightParentId : (partnerRel.second?.id ?? null);
  const hasPartner = Boolean(rightId);
  const leftX = hasPartner ? -(rules.coupleGap / 2 + PERSON_W) : -PERSON_W / 2;
  const rightX = rules.coupleGap / 2;
  const ownMinX = leftX;
  const ownMaxX = hasPartner ? rightX + PERSON_W : leftX + PERSON_W;
  const { leftW, centerW, rightW } = measureKidGroupWidths(relations, partnerRel, leftParentId ?? partnerRel.first.id, rightId, preset);

  if (leftW === 0 && centerW === 0 && rightW === 0) {
    return {
      width: ownMaxX - ownMinX,
      centerOffsetX: -ownMinX,
      leftPersonOffsetX: leftX - ownMinX,
    };
  }

  const starts = kidsGroupStarts(leftW, centerW, rightW, hasPartner, rules.coupleGap, rules.siblingGap, centerBias);
  const minX = Math.min(ownMinX, starts.minX);
  const maxX = Math.max(ownMaxX, starts.maxX);

  return {
    width: maxX - minX,
    centerOffsetX: -minX,
    leftPersonOffsetX: leftX - minX,
  };
}

/** Layout metrics for a person: 1st partner right, 2nd left, then alternating. */
function personLayoutMetrics(
  relations: Relation[],
  personId: string,
  fromPartnershipId?: string,
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
): LayoutMetrics {
  const partnerships = partnersOf(relations, personId, fromPartnershipId);

  if (partnerships.length === 0) {
    return { width: PERSON_W, personOffsetX: 0 };
  }

  if (partnerships.length === 1) {
    const partnerRel = partnerships[0]!;
    const metrics = partnershipLayoutMetrics(relations, partnerRel, personId, otherPartnerId(partnerRel, personId), inheritedPreset);
    return { width: metrics.width, personOffsetX: metrics.leftPersonOffsetX };
  }

  const { minX, maxX } = planMultiPartnerLayout(relations, personId, partnerships, inheritedPreset);
  return {
    width: maxX - minX,
    personOffsetX: -minX,
  };
}

function directChildrenOfPerson(relations: Relation[], personId: string): ParentRelation[] {
  return relations.filter(
    (relation): relation is ParentRelation => isParent(relation) && !relation.parentship?.id && relation.first.id === personId && !relation.second?.id,
  );
}

function subtreeWidth(
  relations: Relation[],
  personId: string,
  fromPartnershipId?: string,
  ancestors: ReadonlySet<string> = new Set(),
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
): number {
  const partnerships = partnersOf(relations, personId, fromPartnershipId);
  if (partnerships.length > 0) return personLayoutMetrics(relations, personId, fromPartnershipId, inheritedPreset).width;
  if (ancestors.has(personId)) return PERSON_W;

  const children = directChildrenOfPerson(relations, personId);
  if (children.length === 0) return PERSON_W;

  const rules = rulesFor(inheritedPreset);
  const nextAncestors = new Set(ancestors).add(personId);
  const childrenWidth =
    children.reduce((total, relation) => {
      const childPreset = presetForRelation(relation, inheritedPreset);
      return total + subtreeWidth(relations, relation.person.id, undefined, nextAncestors, childPreset);
    }, 0) + rules.siblingGap * (children.length - 1);
  return Math.max(PERSON_W, childrenWidth);
}
/** Reuses person.id on first placement; later marriages of a spouse may get a duplicate card. */
function upsertPersonNode(
  nodes: Node[],
  placedPeople: Set<string>,
  person: Person,
  position: { x: number; y: number },
  partnerRelId?: string,
  themeColor: string | null = null,
): string {
  const nodeId = placedPeople.has(person.id) && partnerRelId ? `${person.id}~${partnerRelId}` : person.id;

  const existing = nodes.find((node) => node.id === nodeId);
  if (existing) return nodeId;

  placedPeople.add(person.id);
  nodes.push(getPersonNode(nodeId, person, position, themeColor));
  return nodeId;
}

function addDescentEdge(sourceId: string, childId: string, lane: DescentEdgeData["lane"], edges: Edge[], color: string | null) {
  const id = `${sourceId}->${childId}`;
  if (edges.some((edge) => edge.id === id)) return;
  edges.push({
    id,
    source: sourceId,
    target: childId,
    sourceHandle: "child",
    targetHandle: "parent",
    type: "descent",
    data: { lane },
    style: color ? { stroke: color } : undefined,
  });
}

function addPartnerEdge(personNodeId: string, relationId: string, side: "left" | "right", edges: Edge[], color: string | null) {
  const sourceHandle = side === "left" ? "partner-first" : "partner-second";
  const targetHandle = side === "left" ? "partner-first" : "partner-second";
  const id = `${personNodeId}->${relationId}`;
  if (edges.some((edge) => edge.id === id)) return;
  edges.push({
    id,
    source: personNodeId,
    target: relationId,
    sourceHandle,
    targetHandle,
    type: "partner",
    style: color ? { stroke: color } : undefined,
  });
}

type KidPlacement = {
  child: ReturnType<typeof childrenOf>[number];
  person: Person;
  side: "left" | "center" | "right";
  preset: TreeLayoutPreset;
  width: number;
};

async function placeKidsForPartnership(
  relations: Relation[],
  partnerRel: PartnerRelation,
  centerX: number,
  y: number,
  leftParentId: string,
  rightParentId: string | null,
  leftNodeId: string,
  rightNodeId: string | null,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  resolvePerson: PersonResolver,
  branchColor: string | null,
  inheritedPreset: TreeLayoutPreset,
  centerBias: KidCenterBias = "center",
) {
  const kids = childrenOf(relations, partnerRel).filter((child) => !placedRelations.has(child.id));
  if (kids.length === 0) return;

  for (const child of kids) placedRelations.add(child.id);

  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const kidsWithPeople: KidPlacement[] = await Promise.all(
    kids.map(async (child) => {
      const childPreset = presetForRelation(child, preset);
      return {
        child,
        person: await resolvePerson(child.person.id),
        side: sideOfKid(child, leftParentId, rightParentId),
        preset: childPreset,
        width: subtreeWidth(relations, child.person.id, partnerRel.id, new Set(), childPreset),
      };
    }),
  );

  const byBirth = (first: KidPlacement, second: KidPlacement) => birthRank(first.person) - birthRank(second.person);
  const leftKids = kidsWithPeople.filter((kid) => kid.side === "left").sort(byBirth);
  const centerKids = kidsWithPeople.filter((kid) => kid.side === "center").sort(byBirth);
  const rightKids = kidsWithPeople.filter((kid) => kid.side === "right").sort(byBirth);

  const groupWidth = (group: KidPlacement[]) =>
    group.length === 0 ? 0 : group.reduce((sum, kid) => sum + kid.width, 0) + rules.siblingGap * (group.length - 1);

  const leftW = groupWidth(leftKids);
  const centerW = groupWidth(centerKids);
  const rightW = groupWidth(rightKids);
  const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(rightParentId), rules.coupleGap, rules.siblingGap, centerBias);
  const childY = y + GEN_STEP;

  const placeGroup = async (group: KidPlacement[], startX: number) => {
    let cursor = startX;
    for (const { child, person, side, preset: childPreset, width } of group) {
      const childColor = child.color ?? branchColor;
      const ownPartners = partnersOf(relations, child.person.id, partnerRel.id);
      const childNodeId =
        ownPartners.length > 0
          ? await placePersonWithPartners(
              relations,
              person,
              ownPartners,
              cursor,
              childY,
              nodes,
              edges,
              placedPeople,
              placedRelations,
              resolvePerson,
              childColor,
              childPreset,
              partnerRel.id,
            )
          : await placeSingleParentFamily(
              relations,
              person,
              cursor + width / 2,
              childY,
              nodes,
              edges,
              placedPeople,
              placedRelations,
              resolvePerson,
              childColor,
              childPreset,
            );

      if (side === "center") {
        addDescentEdge(partnerRel.id, childNodeId, "union", edges, childColor);
      } else {
        const parentNodeId = side === "left" ? leftNodeId : (rightNodeId ?? leftNodeId);
        addDescentEdge(parentNodeId, childNodeId, "direct", edges, childColor);
      }
      cursor += width + rules.siblingGap;
    }
  };

  if (leftKids.length) await placeGroup(leftKids, centerX + starts.leftStart);
  if (centerKids.length) await placeGroup(centerKids, centerX + starts.centerStart);
  if (rightKids.length) await placeGroup(rightKids, centerX + starts.rightStart);
}
/**
 * Places one partnership on a given side of an already-placed person.
 * `innerEdgeX` is absolute canvas X of the shared person's edge facing this side.
 */
async function placeSidePartnership(
  relations: Relation[],
  partnerRel: PartnerRelation,
  sharedPerson: Person,
  sharedNodeId: string,
  side: "left" | "right",
  innerEdgeX: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  resolvePerson: PersonResolver,
  inheritedColor: string | null,
  inheritedPreset: TreeLayoutPreset,
) {
  if (placedRelations.has(partnerRel.id)) return;
  placedRelations.add(partnerRel.id);

  const branchColor = partnerRel.color ?? inheritedColor;
  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const relationY = y + PERSON_H / 2 - RELATION_SIZE / 2;
  const otherId = otherPartnerId(partnerRel, sharedPerson.id);
  const other = otherId ? await resolvePerson(otherId) : null;

  let leftParentId: string;
  let rightParentId: string | null;
  let leftNodeId: string;
  let rightNodeId: string | null;
  let centerX: number;

  if (side === "right") {
    const partnerX = innerEdgeX + rules.coupleGap;
    const relationX = innerEdgeX + rules.coupleGap / 2 - RELATION_SIZE / 2;
    centerX = innerEdgeX + rules.coupleGap / 2;

    nodes.push({
      id: partnerRel.id,
      type: "relation",
      position: { x: relationX, y: relationY },
      data: { color: branchColor, layoutPreset: preset },
      draggable: true,
    });

    addPartnerEdge(sharedNodeId, partnerRel.id, "left", edges, branchColor);
    leftParentId = sharedPerson.id;
    leftNodeId = sharedNodeId;

    if (other) {
      rightNodeId = upsertPersonNode(nodes, placedPeople, other, { x: partnerX, y }, partnerRel.id, branchColor);
      addPartnerEdge(rightNodeId, partnerRel.id, "right", edges, branchColor);
      rightParentId = other.id;
    } else {
      rightNodeId = null;
      rightParentId = null;
    }
  } else {
    const partnerX = innerEdgeX - rules.coupleGap - PERSON_W;
    const relationX = innerEdgeX - rules.coupleGap / 2 - RELATION_SIZE / 2;
    centerX = innerEdgeX - rules.coupleGap / 2;

    nodes.push({
      id: partnerRel.id,
      type: "relation",
      position: { x: relationX, y: relationY },
      data: { color: branchColor, layoutPreset: preset },
      draggable: true,
    });

    addPartnerEdge(sharedNodeId, partnerRel.id, "right", edges, branchColor);
    rightParentId = sharedPerson.id;
    rightNodeId = sharedNodeId;

    if (other) {
      leftNodeId = upsertPersonNode(nodes, placedPeople, other, { x: partnerX, y }, partnerRel.id, branchColor);
      addPartnerEdge(leftNodeId, partnerRel.id, "left", edges, branchColor);
      leftParentId = other.id;
    } else {
      leftNodeId = sharedNodeId;
      leftParentId = sharedPerson.id;
      rightParentId = null;
      rightNodeId = null;
    }
  }

  await placeKidsForPartnership(
    relations,
    partnerRel,
    centerX,
    y,
    leftParentId,
    rightParentId,
    leftNodeId,
    rightNodeId,
    nodes,
    edges,
    placedPeople,
    placedRelations,
    resolvePerson,
    branchColor,
    preset,
    side,
  );
}
/**
 * Places a person with all their partnerships: 1st on the right, 2nd on the left, then alternating.
 * The person card is created once and shared across relations.
 */
async function placePersonWithPartners(
  relations: Relation[],
  person: Person,
  partnerships: PartnerRelation[],
  slotLeft: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  resolvePerson: PersonResolver,
  inheritedColor: string | null = null,
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
  fromPartnershipId?: string,
): Promise<string> {
  if (partnerships.length === 1) {
    const partnerRel = partnerships[0]!;
    const otherId = otherPartnerId(partnerRel, person.id);
    const metrics = partnershipLayoutMetrics(relations, partnerRel, person.id, otherId, inheritedPreset);
    return placePartnership(
      relations,
      partnerRel,
      slotLeft + metrics.centerOffsetX,
      y,
      nodes,
      edges,
      placedPeople,
      placedRelations,
      resolvePerson,
      person.id,
      inheritedColor,
      inheritedPreset,
    );
  }

  const metrics = personLayoutMetrics(relations, person.id, fromPartnershipId, inheritedPreset);
  const { sides } = planMultiPartnerLayout(relations, person.id, partnerships, inheritedPreset);
  const personX = slotLeft + metrics.personOffsetX;
  const sharedNodeId = upsertPersonNode(nodes, placedPeople, person, { x: personX, y }, undefined, inheritedColor);

  for (const { partnerRel, side, innerEdgeX } of sides) {
    await placeSidePartnership(
      relations,
      partnerRel,
      person,
      sharedNodeId,
      side,
      personX + innerEdgeX,
      y,
      nodes,
      edges,
      placedPeople,
      placedRelations,
      resolvePerson,
      inheritedColor,
      inheritedPreset,
    );
  }

  return sharedNodeId;
}
async function placePartnership(
  relations: Relation[],
  partnerRel: PartnerRelation,
  centerX: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  resolvePerson: PersonResolver,
  bloodRelativeId?: string,
  inheritedColor: string | null = null,
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
): Promise<string> {
  if (placedRelations.has(partnerRel.id)) return bloodRelativeId ?? partnerRel.first.id;
  placedRelations.add(partnerRel.id);

  const branchColor = partnerRel.color ?? inheritedColor;
  const preset = presetForRelation(partnerRel, inheritedPreset);
  const rules = rulesFor(preset);
  const first = await resolvePerson(partnerRel.first.id);
  const second = partnerRel.second?.id ? await resolvePerson(partnerRel.second.id) : null;

  let left = first;
  let right = second;

  if (bloodRelativeId && second) {
    if (second.id === bloodRelativeId) {
      left = second;
      right = first;
    } else {
      left = first;
      right = second;
    }
  }

  const hasPartner = Boolean(right);
  const leftX = hasPartner ? centerX - rules.coupleGap / 2 - PERSON_W : centerX - PERSON_W / 2;
  const rightX = centerX + rules.coupleGap / 2;
  const relationX = centerX - RELATION_SIZE / 2;
  const relationY = y + PERSON_H / 2 - RELATION_SIZE / 2;

  nodes.push({
    id: partnerRel.id,
    type: "relation",
    position: { x: relationX, y: relationY },
    data: { color: branchColor, layoutPreset: preset, root: partnerRel.root },
    draggable: true,
  });

  const leftNodeId = upsertPersonNode(nodes, placedPeople, left, { x: leftX, y }, partnerRel.id, branchColor);
  addPartnerEdge(leftNodeId, partnerRel.id, "left", edges, branchColor);

  let rightNodeId: string | null = null;
  if (right) {
    rightNodeId = upsertPersonNode(nodes, placedPeople, right, { x: rightX, y }, partnerRel.id, branchColor);
    addPartnerEdge(rightNodeId, partnerRel.id, "right", edges, branchColor);
  }

  await placeKidsForPartnership(
    relations,
    partnerRel,
    centerX,
    y,
    left.id,
    right?.id ?? null,
    leftNodeId,
    rightNodeId,
    nodes,
    edges,
    placedPeople,
    placedRelations,
    resolvePerson,
    branchColor,
    preset,
  );

  if (bloodRelativeId && right?.id === bloodRelativeId && rightNodeId) return rightNodeId;
  return leftNodeId;
}
async function placeSingleParentFamily(
  relations: Relation[],
  person: Person,
  centerX: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  resolvePerson: PersonResolver,
  branchColor: string | null = null,
  inheritedPreset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
  root = false,
): Promise<string> {
  const rules = rulesFor(inheritedPreset);
  const parentNodeId = upsertPersonNode(nodes, placedPeople, person, { x: centerX - PERSON_W / 2, y }, undefined, branchColor);
  if (root) {
    const rootNode = nodes.find((node) => node.id === parentNodeId);
    if (rootNode) rootNode.data = { ...rootNode.data, root: true };
  }

  const childRelations = directChildrenOfPerson(relations, person.id).filter((relation) => !placedRelations.has(relation.id));
  if (childRelations.length === 0) return parentNodeId;

  const children = await Promise.all(
    childRelations.map(async (relation) => {
      const childPreset = presetForRelation(relation, inheritedPreset);
      return {
        relation,
        person: await resolvePerson(relation.person.id),
        preset: childPreset,
        width: subtreeWidth(relations, relation.person.id, undefined, new Set(), childPreset),
      };
    }),
  );
  children.sort((first, second) => birthRank(first.person) - birthRank(second.person));

  const childrenWidth = children.reduce((total, child) => total + child.width, 0) + rules.siblingGap * (children.length - 1);
  let cursor = centerX - childrenWidth / 2;
  const childY = y + GEN_STEP;

  for (const child of children) {
    placedRelations.add(child.relation.id);
    const childColor = child.relation.color ?? branchColor;
    const partnerships = partnersOf(relations, child.person.id);
    const childNodeId =
      partnerships.length > 0
        ? await placePersonWithPartners(
            relations,
            child.person,
            partnerships,
            cursor,
            childY,
            nodes,
            edges,
            placedPeople,
            placedRelations,
            resolvePerson,
            childColor,
            child.preset,
          )
        : await placeSingleParentFamily(
            relations,
            child.person,
            cursor + child.width / 2,
            childY,
            nodes,
            edges,
            placedPeople,
            placedRelations,
            resolvePerson,
            childColor,
            child.preset,
          );

    addDescentEdge(parentNodeId, childNodeId, "direct", edges, childColor);
    cursor += child.width + rules.siblingGap;
  }

  return parentNodeId;
}
function centerTreeUnderRoot(nodes: Node[], edges: Edge[], rootRelationId: string): Node[] {
  const rootNode = nodes.find((node) => node.id === rootRelationId);
  if (!rootNode) return nodes;

  const rootRowNodeIds = new Set([
    rootRelationId,
    ...edges.filter((edge) => edge.type === "partner" && edge.target === rootRelationId).map((edge) => edge.source),
  ]);
  const descendants = nodes.filter((node) => !rootRowNodeIds.has(node.id));
  if (descendants.length === 0) return nodes;

  const minX = Math.min(...descendants.map((node) => node.position.x));
  const maxX = Math.max(...descendants.map((node) => node.position.x + (node.type === "person" ? PERSON_W : RELATION_SIZE)));
  const rootCenterX = rootNode.position.x + RELATION_SIZE / 2;
  const offsetX = rootCenterX - (minX + maxX) / 2;
  if (Math.abs(offsetX) < 0.5) return nodes;

  return nodes.map((node) =>
    rootRowNodeIds.has(node.id)
      ? node
      : {
          ...node,
          position: { ...node.position, x: node.position.x + offsetX },
        },
  );
}
export async function buildGenealogyGraph(
  relations: Relation[],
  peopleById?: ReadonlyMap<string, Person>,
  preset: TreeLayoutPreset = DEFAULT_TREE_LAYOUT_PRESET,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const partnerRoot = relations.find((relation): relation is PartnerRelation => isPartner(relation) && relation.root);
  const directParentRelations = relations.filter(
    (relation): relation is ParentRelation => isParent(relation) && !relation.second?.id && !relation.parentship?.id,
  );
  const explicitSingleParentRoot = directParentRelations.find((relation) => relation.root);
  const childIds = new Set(relations.filter(isParent).map((relation) => relation.person.id));
  const singleParentRoot = explicitSingleParentRoot ?? directParentRelations.find((relation) => !childIds.has(relation.first.id));
  if (!partnerRoot && !singleParentRoot) return { nodes: [], edges: [] };

  const resolvePerson: PersonResolver = peopleById
    ? async (id) => {
        const person = peopleById.get(id);
        if (!person) throw new Error(`Brak osoby ${id} wymaganej przez relację.`);
        return person;
      }
    : getPerson;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (partnerRoot) {
    await placePartnership(relations, partnerRoot, 0, 0, nodes, edges, new Set(), new Set(), resolvePerson, undefined, null, preset);
    return { nodes: centerTreeUnderRoot(nodes, edges, partnerRoot.id), edges };
  }

  if (!singleParentRoot) return { nodes, edges };
  const rootPerson = await resolvePerson(singleParentRoot.first.id);
  await placeSingleParentFamily(
    relations,
    rootPerson,
    0,
    0,
    nodes,
    edges,
    new Set(),
    new Set(),
    resolvePerson,
    null,
    presetForRelation(singleParentRoot, preset),
    true,
  );
  return { nodes, edges };
}
