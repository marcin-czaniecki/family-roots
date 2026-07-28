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
export const RELATION_SIZE = 44;
export const DEFAULT_TREE_LAYOUT_PRESET: TreeLayoutPreset = "compact";
export const TREE_LAYOUT_PRESET_OPTIONS: ReadonlyArray<{ value: TreeLayoutPreset; label: string; description: string }> = [
  { value: "compact", label: "Zwarty warstwowy", description: "Rodziny są ciasno układane w rzędach kolejnych pokoleń." },
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
  compact: { siblingGap: 24, coupleGap: RELATION_SIZE + 16, multiPartnerGap: 48 },
  balanced: { siblingGap: 64, coupleGap: RELATION_SIZE + 24, multiPartnerGap: 96 },
  spacious: { siblingGap: 96, coupleGap: RELATION_SIZE + 36, multiPartnerGap: 144 },
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
    width: PERSON_W,
    height: PERSON_H,
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
    }, 0) +
    rules.siblingGap * (children.length - 1);
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

function addDescentEdge(sourceId: string, childId: string, lane: DescentEdgeData["lane"], edges: Edge[], color: string | null, layoutPreset: TreeLayoutPreset) {
  const id = `${sourceId}->${childId}`;
  if (edges.some((edge) => edge.id === id)) return;
  edges.push({
    id,
    source: sourceId,
    target: childId,
    sourceHandle: "child",
    targetHandle: "parent",
    type: "descent",
    data: { lane, layoutPreset },
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
        addDescentEdge(partnerRel.id, childNodeId, "union", edges, childColor, childPreset);
      } else {
        const parentNodeId = side === "left" ? leftNodeId : (rightNodeId ?? leftNodeId);
        addDescentEdge(parentNodeId, childNodeId, "direct", edges, childColor, childPreset);
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
      width: RELATION_SIZE,
      height: RELATION_SIZE,
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
      width: RELATION_SIZE,
      height: RELATION_SIZE,
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
    width: RELATION_SIZE,
    height: RELATION_SIZE,
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

    addDescentEdge(parentNodeId, childNodeId, "direct", edges, childColor, child.preset);
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
type RowUnit = {
  id: string;
  nodeIds: string[];
  originalCenterX: number;
  preset: TreeLayoutPreset;
};

const COMPACT_ROW_GAP = 48;
const EDGE_LANE_MIN_OFFSET = 28;
const EDGE_LANE_MAX_OFFSET = 136;
const EDGE_LANE_PREFERRED_GAP = 14;
const EDGE_LANE_HORIZONTAL_CLEARANCE = 12;
const ROW_GAP_BY_PRESET: Record<TreeLayoutPreset, number> = {
  compact: COMPACT_ROW_GAP,
  balanced: 64,
  spacious: 96,
};
const PRESET_RANK: Record<TreeLayoutPreset, number> = {
  compact: 0,
  balanced: 1,
  spacious: 2,
};

function nodeWidth(node: Node): number {
  return node.type === "person" ? PERSON_W : RELATION_SIZE;
}

function nodeCenterX(node: Node): number {
  return node.position.x + nodeWidth(node) / 2;
}

function isTreeLayoutPreset(value: unknown): value is TreeLayoutPreset {
  return value === "compact" || value === "balanced" || value === "spacious";
}

function widestLayoutPreset(presets: Array<TreeLayoutPreset | null | undefined>): TreeLayoutPreset {
  return presets.reduce<TreeLayoutPreset>((widest, preset) => (preset && PRESET_RANK[preset] > PRESET_RANK[widest] ? preset : widest), "compact");
}

function nodeLayoutPreset(node: Node): TreeLayoutPreset | null {
  const preset = (node.data as { layoutPreset?: unknown } | undefined)?.layoutPreset;
  return isTreeLayoutPreset(preset) ? preset : null;
}

function edgeLayoutPreset(edge: Edge): TreeLayoutPreset | null {
  const preset = (edge.data as DescentEdgeData | undefined)?.layoutPreset;
  return isTreeLayoutPreset(preset) ? preset : null;
}

function rowGapBetween(first: RowUnit, second: RowUnit): number {
  return Math.max(ROW_GAP_BY_PRESET[first.preset], ROW_GAP_BY_PRESET[second.preset]);
}

function projectNonDecreasing(values: number[]): number[] {
  const blocks: Array<{ start: number; end: number; sum: number; count: number }> = [];

  for (let index = 0; index < values.length; index += 1) {
    blocks.push({ start: index, end: index, sum: values[index], count: 1 });
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        sum: left.sum + right.sum,
        count: left.count + right.count,
      });
    }
  }

  const projected = new Array<number>(values.length);
  for (const block of blocks) {
    const value = block.sum / block.count;
    for (let index = block.start; index <= block.end; index += 1) projected[index] = value;
  }
  return projected;
}

/**
 * Packs same-generation family units without flattening branch-specific presets.
 * Balanced and spacious branches retain their recursive offsets from the legacy layout.
 */
function compactGenerationRows(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length < 2) return nodes;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (firstId: string, secondId: string) => {
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  for (const edge of edges) {
    if (edge.type === "partner" && nodeById.has(edge.source) && nodeById.has(edge.target)) {
      union(edge.source, edge.target);
    }
  }

  const componentNodeIds = new Map<string, string[]>();
  for (const node of nodes) {
    const componentId = find(node.id);
    const ids = componentNodeIds.get(componentId) ?? [];
    ids.push(node.id);
    componentNodeIds.set(componentId, ids);
  }

  const componentByNodeId = new Map<string, string>();
  for (const [componentId, nodeIds] of componentNodeIds) {
    for (const nodeId of nodeIds) componentByNodeId.set(nodeId, componentId);
  }

  const incomingEdgesByComponent = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (edge.type !== "descent") continue;
    const targetComponentId = componentByNodeId.get(edge.target);
    const sourceComponentId = componentByNodeId.get(edge.source);
    if (!targetComponentId || targetComponentId === sourceComponentId) continue;
    const incoming = incomingEdgesByComponent.get(targetComponentId) ?? [];
    incoming.push(edge);
    incomingEdgesByComponent.set(targetComponentId, incoming);
  }

  const rows = new Map<number, RowUnit[]>();
  for (const [id, nodeIds] of componentNodeIds) {
    const componentNodes = nodeIds.map((nodeId) => nodeById.get(nodeId)).filter((node): node is Node => Boolean(node));
    const personNode = componentNodes.find((node) => node.type === "person");
    const y = personNode?.position.y ?? componentNodes[0]?.position.y ?? 0;
    const minX = Math.min(...componentNodes.map((node) => node.position.x));
    const maxX = Math.max(...componentNodes.map((node) => node.position.x + nodeWidth(node)));
    const preset = widestLayoutPreset([...componentNodes.map(nodeLayoutPreset), ...(incomingEdgesByComponent.get(id) ?? []).map(edgeLayoutPreset)]);
    const unit: RowUnit = { id, nodeIds, originalCenterX: (minX + maxX) / 2, preset };
    const row = rows.get(y) ?? [];
    row.push(unit);
    rows.set(y, row);
  }

  const positioned = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));
  const generationYs = [...rows.keys()].sort((first, second) => (TREE_GROWS_UP ? second - first : first - second));

  for (const y of generationYs) {
    const units = rows.get(y) ?? [];
    const desiredCenter = new Map<string, number>();

    for (const unit of units) {
      const incomingCenters = (incomingEdgesByComponent.get(unit.id) ?? []).flatMap((edge) => {
        const currentSource = positioned.get(edge.source);
        const originalSource = nodeById.get(edge.source);
        if (!currentSource) return [];
        const currentCenter = nodeCenterX(currentSource);
        if (unit.preset === "compact" || !originalSource) return [currentCenter];
        return [currentCenter + unit.originalCenterX - nodeCenterX(originalSource)];
      });
      desiredCenter.set(
        unit.id,
        incomingCenters.length > 0 ? incomingCenters.reduce((total, center) => total + center, 0) / incomingCenters.length : unit.originalCenterX,
      );
    }

    units.sort(
      (first, second) =>
        (desiredCenter.get(first.id) ?? first.originalCenterX) - (desiredCenter.get(second.id) ?? second.originalCenterX) ||
        first.originalCenterX - second.originalCenterX,
    );

    const placements = units.map((unit) => {
      const componentNodes = unit.nodeIds.map((nodeId) => positioned.get(nodeId)).filter((node): node is Node => Boolean(node));
      const minX = Math.min(...componentNodes.map((node) => node.position.x));
      const maxX = Math.max(...componentNodes.map((node) => node.position.x + nodeWidth(node)));
      return { unit, currentCenter: (minX + maxX) / 2, width: maxX - minX, minimumCenter: 0 };
    });

    let minimumCenter = 0;
    for (let index = 0; index < placements.length; index += 1) {
      if (index > 0) {
        minimumCenter += placements[index - 1].width / 2 + rowGapBetween(placements[index - 1].unit, placements[index].unit) + placements[index].width / 2;
      }
      placements[index].minimumCenter = minimumCenter;
    }

    const projected = projectNonDecreasing(
      placements.map((placement) => (desiredCenter.get(placement.unit.id) ?? placement.unit.originalCenterX) - placement.minimumCenter),
    );

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      const center = projected[index] + placement.minimumCenter;
      const deltaX = center - placement.currentCenter;
      for (const nodeId of placement.unit.nodeIds) {
        const node = positioned.get(nodeId);
        if (node) node.position.x += deltaX;
      }
    }
  }

  return nodes.map((node) => positioned.get(node.id) ?? node);
}
type DescentRouteGroup = {
  edgeIds: string[];
  minX: number;
  maxX: number;
  lane: number;
};

function routeDescentEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupsByGeneration = new Map<number, Map<string, DescentRouteGroup>>();

  for (const edge of edges) {
    if (edge.type !== "descent") continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourceX = source.position.x + nodeWidth(source) / 2;
    const targetX = target.position.x + nodeWidth(target) / 2;
    const generationGroups = groupsByGeneration.get(target.position.y) ?? new Map<string, DescentRouteGroup>();
    const group = generationGroups.get(edge.source) ?? {
      edgeIds: [],
      minX: Math.min(sourceX, targetX),
      maxX: Math.max(sourceX, targetX),
      lane: 0,
    };
    group.edgeIds.push(edge.id);
    group.minX = Math.min(group.minX, sourceX, targetX);
    group.maxX = Math.max(group.maxX, sourceX, targetX);
    generationGroups.set(edge.source, group);
    groupsByGeneration.set(target.position.y, generationGroups);
  }

  const offsetByEdgeId = new Map<string, number>();
  for (const generationGroups of groupsByGeneration.values()) {
    const groups = [...generationGroups.values()].sort((first, second) => first.minX - second.minX || first.maxX - second.maxX);
    const laneEnds: number[] = [];
    for (const group of groups) {
      let lane = laneEnds.findIndex((endX) => endX + EDGE_LANE_HORIZONTAL_CLEARANCE <= group.minX);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(group.maxX);
      } else {
        laneEnds[lane] = group.maxX;
      }
      group.lane = lane;
    }

    const laneGap = laneEnds.length <= 1 ? 0 : Math.min(EDGE_LANE_PREFERRED_GAP, (EDGE_LANE_MAX_OFFSET - EDGE_LANE_MIN_OFFSET) / (laneEnds.length - 1));
    for (const group of groups) {
      const offset = EDGE_LANE_MIN_OFFSET + group.lane * laneGap;
      for (const edgeId of group.edgeIds) offsetByEdgeId.set(edgeId, offset);
    }
  }

  return edges.map((edge) =>
    edge.type === "descent"
      ? {
          ...edge,
          data: { ...(edge.data as DescentEdgeData | undefined), barOffset: offsetByEdgeId.get(edge.id) },
        }
      : edge,
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
    const rootPreset = presetForRelation(partnerRoot, preset);
    await placePartnership(relations, partnerRoot, 0, 0, nodes, edges, new Set(), new Set(), resolvePerson, undefined, null, preset);
    const centeredNodes = centerTreeUnderRoot(nodes, edges, partnerRoot.id);
    const compactedNodes = rootPreset === "compact" ? compactGenerationRows(centeredNodes, edges) : centeredNodes;
    const finalNodes = centerTreeUnderRoot(compactedNodes, edges, partnerRoot.id);
    return { nodes: finalNodes, edges: routeDescentEdges(finalNodes, edges) };
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
  const finalNodes = presetForRelation(singleParentRoot, preset) === "compact" ? compactGenerationRows(nodes, edges) : nodes;
  return { nodes: finalNodes, edges: routeDescentEdges(finalNodes, edges) };
}
