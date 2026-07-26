import type { Edge, EdgeTypes, Node } from "@xyflow/react";
import { DescentEdge, type DescentEdgeData, PartnerEdge } from "@/components/GenealogyEdges";
import { PersonNode } from "@/components/PersonNode";
import { RelationNode } from "@/components/RelationNode";
import { getPerson } from "@/entities/person/getPerson";
import type { Person } from "@/entities/person/types";
import { childrenOf, isPartner, partnersOf, sideOfKid } from "@/entities/relation/helpers";
import type { PartnerRelation, Relation } from "@/entities/relation/types";
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
const RELATION_SIZE = 14;
const GAP = 64;
const GEN_H = 400;
const COUPLE_GAP = 40;
const MULTI_PARTNER_GAP = 96;
const GEN_STEP = TREE_GROWS_UP ? -GEN_H : GEN_H;

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

function getPersonNode(id: string, person: Person, position: { x: number; y: number }): PersonFlowNode {
  return {
    id,
    type: "person",
    position,
    data: person as PersonNodeData,
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
): { minX: number; maxX: number } {
  const otherId = otherPartnerId(partnerRel, sharedPersonId);
  const leftParentId = side === "right" ? sharedPersonId : (otherId ?? sharedPersonId);
  const rightParentId = side === "right" ? otherId : otherId ? sharedPersonId : null;
  const { leftW, centerW, rightW } = measureKidGroupWidths(relations, partnerRel, leftParentId, rightParentId);
  const hasKids = leftW > 0 || centerW > 0 || rightW > 0;
  const unionX = side === "right" ? innerEdgeX + COUPLE_GAP / 2 : innerEdgeX - COUPLE_GAP / 2;

  if (side === "right") {
    const partnerLeft = otherId ? innerEdgeX + COUPLE_GAP : innerEdgeX;
    const partnerRight = otherId ? partnerLeft + PERSON_W : innerEdgeX;
    if (!hasKids) return { minX: Math.min(innerEdgeX, partnerLeft), maxX: partnerRight };
    const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(otherId), "right");
    return {
      minX: Math.min(innerEdgeX, partnerLeft, unionX + starts.minX),
      maxX: Math.max(partnerRight, unionX + starts.maxX),
    };
  }

  const partnerLeft = otherId ? innerEdgeX - COUPLE_GAP - PERSON_W : innerEdgeX;
  const partnerRight = otherId ? partnerLeft + PERSON_W : innerEdgeX;
  if (!hasKids) return { minX: partnerLeft, maxX: Math.max(innerEdgeX, partnerRight) };
  const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(rightParentId), "left");
  return {
    minX: Math.min(partnerLeft, unionX + starts.minX),
    maxX: Math.max(innerEdgeX, partnerRight, unionX + starts.maxX),
  };
}

/** Builds side plans + bounding box for multi-partner layout (person-local, person at 0). */
function planMultiPartnerLayout(relations: Relation[], personId: string, partnerships: PartnerRelation[]): { sides: SidePlan[]; minX: number; maxX: number } {
  const sides: SidePlan[] = [];
  let minX = 0;
  let maxX = PERSON_W;

  let rightBoundary = PERSON_W;
  let hasRightSide = false;
  for (let i = 0; i < partnerships.length; i += 2) {
    const partnerRel = partnerships[i];
    if (!partnerRel) continue;
    const baseBounds = sidePartnershipBounds(relations, partnerRel, personId, "right", 0);
    const rightInner = hasRightSide ? rightBoundary + MULTI_PARTNER_GAP - baseBounds.minX : PERSON_W;
    sides.push({ partnerRel, side: "right", innerEdgeX: rightInner });
    const bounds = sidePartnershipBounds(relations, partnerRel, personId, "right", rightInner);
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
    const baseBounds = sidePartnershipBounds(relations, partnerRel, personId, "left", 0);
    const innerEdgeX = hasLeftSide ? leftBoundary - MULTI_PARTNER_GAP - baseBounds.maxX : 0;
    sides.push({ partnerRel, side: "left", innerEdgeX });
    const bounds = sidePartnershipBounds(relations, partnerRel, personId, "left", innerEdgeX);
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
  centerBias: KidCenterBias = "center",
): { leftStart: number; centerStart: number; rightStart: number; minX: number; maxX: number } {
  const leftParentLeft = -(COUPLE_GAP / 2 + PERSON_W);
  const rightParentRight = hasRightParent ? COUPLE_GAP / 2 + PERSON_W : PERSON_W / 2;

  let centerStart = -centerW / 2;
  let centerEnd = centerW / 2;

  if (centerW > 0 && centerBias === "left") {
    centerEnd = leftParentLeft - GAP;
    centerStart = centerEnd - centerW;
  }

  if (centerW > 0 && centerBias === "right") {
    centerStart = rightParentRight + GAP;
    centerEnd = centerStart + centerW;
  }

  let leftEnd = centerW > 0 && centerBias !== "right" ? centerStart - GAP : leftParentLeft - GAP;
  leftEnd = Math.min(leftEnd, leftParentLeft - GAP);
  const leftStart = leftW > 0 ? leftEnd - leftW : 0;

  let rightStart = centerW > 0 && centerBias !== "left" ? centerEnd + GAP : rightParentRight + GAP;
  rightStart = Math.max(rightStart, rightParentRight + GAP);

  const minX = Math.min(leftW > 0 ? leftStart : 0, centerW > 0 ? centerStart : 0, leftParentLeft);
  const maxX = Math.max(rightW > 0 ? rightStart + rightW : 0, centerW > 0 ? centerEnd : 0, rightParentRight);

  return { leftStart, centerStart, rightStart, minX, maxX };
}

function measureKidGroupWidths(
  relations: Relation[],
  partnerRel: PartnerRelation,
  leftParentId: string,
  rightParentId: string | null,
): { leftW: number; centerW: number; rightW: number } {
  const kids = childrenOf(relations, partnerRel);
  const widths = { left: [] as number[], center: [] as number[], right: [] as number[] };

  for (const child of kids) {
    const w = subtreeWidth(relations, child.person.id, partnerRel.id);
    widths[sideOfKid(child, leftParentId, rightParentId)].push(w);
  }

  const sum = (list: number[]) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) + GAP * (list.length - 1));
  return { leftW: sum(widths.left), centerW: sum(widths.center), rightW: sum(widths.right) };
}

function partnershipLayoutMetrics(
  relations: Relation[],
  partnerRel: PartnerRelation,
  leftParentId?: string,
  rightParentId?: string | null,
  centerBias: KidCenterBias = "center",
): PartnershipLayoutMetrics {
  const rightId = rightParentId !== undefined ? rightParentId : (partnerRel.second?.id ?? null);
  const hasPartner = Boolean(rightId);
  const leftX = hasPartner ? -(COUPLE_GAP / 2 + PERSON_W) : -PERSON_W / 2;
  const rightX = COUPLE_GAP / 2;
  const ownMinX = leftX;
  const ownMaxX = hasPartner ? rightX + PERSON_W : leftX + PERSON_W;
  const { leftW, centerW, rightW } = measureKidGroupWidths(relations, partnerRel, leftParentId ?? partnerRel.first.id, rightId);

  if (leftW === 0 && centerW === 0 && rightW === 0) {
    return {
      width: ownMaxX - ownMinX,
      centerOffsetX: -ownMinX,
      leftPersonOffsetX: leftX - ownMinX,
    };
  }

  const starts = kidsGroupStarts(leftW, centerW, rightW, hasPartner, centerBias);
  const minX = Math.min(ownMinX, starts.minX);
  const maxX = Math.max(ownMaxX, starts.maxX);

  return {
    width: maxX - minX,
    centerOffsetX: -minX,
    leftPersonOffsetX: leftX - minX,
  };
}

/** Layout metrics for a person: 1st partner right, 2nd left, then alternating. */
function personLayoutMetrics(relations: Relation[], personId: string, fromPartnershipId?: string): LayoutMetrics {
  const partnerships = partnersOf(relations, personId, fromPartnershipId);

  if (partnerships.length === 0) {
    return { width: PERSON_W, personOffsetX: 0 };
  }

  if (partnerships.length === 1) {
    const partnerRel = partnerships[0]!;
    // Blood relative is placed on the left of the couple.
    const metrics = partnershipLayoutMetrics(relations, partnerRel, personId, otherPartnerId(partnerRel, personId));
    return { width: metrics.width, personOffsetX: metrics.leftPersonOffsetX };
  }

  const { minX, maxX } = planMultiPartnerLayout(relations, personId, partnerships);
  return {
    width: maxX - minX,
    personOffsetX: -minX,
  };
}

function subtreeWidth(relations: Relation[], personId: string, fromPartnershipId?: string): number {
  return personLayoutMetrics(relations, personId, fromPartnershipId).width;
}

/** Reuses person.id on first placement; later marriages of a spouse may get a duplicate card. */
function upsertPersonNode(nodes: Node[], placedPeople: Set<string>, person: Person, position: { x: number; y: number }, partnerRelId?: string): string {
  const nodeId = placedPeople.has(person.id) && partnerRelId ? `${person.id}~${partnerRelId}` : person.id;

  const existing = nodes.find((node) => node.id === nodeId);
  if (existing) {
    existing.position = position;
    return nodeId;
  }

  placedPeople.add(person.id);
  nodes.push(getPersonNode(nodeId, person, position));
  return nodeId;
}

function addDescentEdge(sourceId: string, childId: string, lane: DescentEdgeData["lane"], edges: Edge[]) {
  edges.push({
    id: `${sourceId}->${childId}`,
    source: sourceId,
    target: childId,
    sourceHandle: "child",
    targetHandle: "parent",
    type: "descent",
    data: { lane },
  });
}

function addPartnerEdge(personNodeId: string, relationId: string, side: "left" | "right", edges: Edge[]) {
  const sourceHandle = side === "left" ? "partner-first" : "partner-second";
  const targetHandle = side === "left" ? "partner-first" : "partner-second";
  edges.push({
    id: `${personNodeId}->${relationId}`,
    source: personNodeId,
    target: relationId,
    sourceHandle,
    targetHandle,
    type: "partner",
  });
}

type KidPlacement = {
  child: ReturnType<typeof childrenOf>[number];
  person: Person;
  side: "left" | "center" | "right";
  width: number;
  personOffsetX: number;
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
  centerBias: KidCenterBias = "center",
) {
  const kids = childrenOf(relations, partnerRel);
  if (kids.length === 0) return;

  const kidsWithPeople: KidPlacement[] = await Promise.all(
    kids.map(async (child) => {
      const metrics = personLayoutMetrics(relations, child.person.id, partnerRel.id);
      return {
        child,
        person: await resolvePerson(child.person.id),
        side: sideOfKid(child, leftParentId, rightParentId),
        width: metrics.width,
        personOffsetX: metrics.personOffsetX,
      };
    }),
  );

  const byBirth = (a: KidPlacement, b: KidPlacement) => birthRank(a.person) - birthRank(b.person);
  const leftKids = kidsWithPeople.filter((k) => k.side === "left").sort(byBirth);
  const centerKids = kidsWithPeople.filter((k) => k.side === "center").sort(byBirth);
  const rightKids = kidsWithPeople.filter((k) => k.side === "right").sort(byBirth);

  const groupWidth = (group: KidPlacement[]) => (group.length === 0 ? 0 : group.reduce((sum, k) => sum + k.width, 0) + GAP * (group.length - 1));

  const leftW = groupWidth(leftKids);
  const centerW = groupWidth(centerKids);
  const rightW = groupWidth(rightKids);

  const starts = kidsGroupStarts(leftW, centerW, rightW, Boolean(rightParentId), centerBias);
  const leftStart = centerX + starts.leftStart;
  const centerStart = centerX + starts.centerStart;
  const rightStart = centerX + starts.rightStart;

  const childY = y + GEN_STEP;

  const placeGroup = async (group: KidPlacement[], startX: number) => {
    let cursor = startX;
    for (const { child, person, side, width: w, personOffsetX } of group) {
      const ownPartners = partnersOf(relations, child.person.id, partnerRel.id);
      let childNodeId: string;

      if (ownPartners.length > 0) {
        childNodeId = await placePersonWithPartners(
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
          partnerRel.id,
        );
      } else {
        childNodeId = upsertPersonNode(nodes, placedPeople, person, { x: cursor + personOffsetX, y: childY });
      }

      if (side === "center") {
        addDescentEdge(partnerRel.id, childNodeId, "union", edges);
      } else {
        const parentNodeId = side === "left" ? leftNodeId : (rightNodeId ?? leftNodeId);
        addDescentEdge(parentNodeId, childNodeId, "direct", edges);
      }
      cursor += w + GAP;
    }
  };

  if (leftKids.length) await placeGroup(leftKids, leftStart);
  if (centerKids.length) await placeGroup(centerKids, centerStart);
  if (rightKids.length) await placeGroup(rightKids, rightStart);
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
) {
  if (placedRelations.has(partnerRel.id)) return;
  placedRelations.add(partnerRel.id);

  const relationY = y + PERSON_H / 2 - RELATION_SIZE / 2;
  const otherId = otherPartnerId(partnerRel, sharedPerson.id);
  const other = otherId ? await resolvePerson(otherId) : null;

  let leftParentId: string;
  let rightParentId: string | null;
  let leftNodeId: string;
  let rightNodeId: string | null;
  let centerX: number;

  if (side === "right") {
    const partnerX = innerEdgeX + COUPLE_GAP;
    const relationX = innerEdgeX + COUPLE_GAP / 2 - RELATION_SIZE / 2;
    centerX = innerEdgeX + COUPLE_GAP / 2;

    nodes.push({
      id: partnerRel.id,
      type: "relation",
      position: { x: relationX, y: relationY },
      data: {},
      draggable: true,
    });

    addPartnerEdge(sharedNodeId, partnerRel.id, "left", edges);
    leftParentId = sharedPerson.id;
    leftNodeId = sharedNodeId;

    if (other) {
      rightNodeId = upsertPersonNode(nodes, placedPeople, other, { x: partnerX, y }, partnerRel.id);
      addPartnerEdge(rightNodeId, partnerRel.id, "right", edges);
      rightParentId = other.id;
    } else {
      rightNodeId = null;
      rightParentId = null;
    }
  } else {
    const partnerX = innerEdgeX - COUPLE_GAP - PERSON_W;
    const relationX = innerEdgeX - COUPLE_GAP / 2 - RELATION_SIZE / 2;
    centerX = innerEdgeX - COUPLE_GAP / 2;

    nodes.push({
      id: partnerRel.id,
      type: "relation",
      position: { x: relationX, y: relationY },
      data: {},
      draggable: true,
    });

    addPartnerEdge(sharedNodeId, partnerRel.id, "right", edges);
    rightParentId = sharedPerson.id;
    rightNodeId = sharedNodeId;

    if (other) {
      leftNodeId = upsertPersonNode(nodes, placedPeople, other, { x: partnerX, y }, partnerRel.id);
      addPartnerEdge(leftNodeId, partnerRel.id, "left", edges);
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
  fromPartnershipId?: string,
): Promise<string> {
  if (partnerships.length === 1) {
    const partnerRel = partnerships[0]!;
    const otherId = otherPartnerId(partnerRel, person.id);
    const metrics = partnershipLayoutMetrics(relations, partnerRel, person.id, otherId);
    return placePartnership(relations, partnerRel, slotLeft + metrics.centerOffsetX, y, nodes, edges, placedPeople, placedRelations, resolvePerson, person.id);
  }

  const metrics = personLayoutMetrics(relations, person.id, fromPartnershipId);
  const { sides } = planMultiPartnerLayout(relations, person.id, partnerships);
  const personX = slotLeft + metrics.personOffsetX;
  const sharedNodeId = upsertPersonNode(nodes, placedPeople, person, { x: personX, y });

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
): Promise<string> {
  if (placedRelations.has(partnerRel.id)) return bloodRelativeId ?? partnerRel.first.id;
  placedRelations.add(partnerRel.id);

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
  const leftX = hasPartner ? centerX - COUPLE_GAP / 2 - PERSON_W : centerX - PERSON_W / 2;
  const rightX = centerX + COUPLE_GAP / 2;
  const relationX = centerX - RELATION_SIZE / 2;
  const relationY = y + PERSON_H / 2 - RELATION_SIZE / 2;

  nodes.push({
    id: partnerRel.id,
    type: "relation",
    position: { x: relationX, y: relationY },
    data: { root: partnerRel.root },
    draggable: true,
  });

  const leftNodeId = upsertPersonNode(nodes, placedPeople, left, { x: leftX, y }, partnerRel.id);
  addPartnerEdge(leftNodeId, partnerRel.id, "left", edges);

  let rightNodeId: string | null = null;
  if (right) {
    rightNodeId = upsertPersonNode(nodes, placedPeople, right, { x: rightX, y }, partnerRel.id);
    addPartnerEdge(rightNodeId, partnerRel.id, "right", edges);
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
  );

  if (bloodRelativeId && right?.id === bloodRelativeId && rightNodeId) return rightNodeId;
  return leftNodeId;
}

export async function buildGenealogyGraph(relations: Relation[], peopleById?: ReadonlyMap<string, Person>): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const root = relations.find((r): r is PartnerRelation => isPartner(r) && r.root);
  if (!root) return { nodes: [], edges: [] };

  const resolvePerson: PersonResolver = peopleById
    ? async (id) => {
        const person = peopleById.get(id);
        if (!person) throw new Error(`Brak osoby ${id} wymaganej przez relację.`);
        return person;
      }
    : getPerson;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  await placePartnership(relations, root, 0, 0, nodes, edges, new Set(), new Set(), resolvePerson);
  return { nodes, edges };
}
