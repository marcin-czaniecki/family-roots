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

export const PERSON_W = 168;
export const PERSON_H = 268;
const RELATION_SIZE = 14;
const GAP = 64;
const GEN_H = 400;
const COUPLE_GAP = 40;
const MULTI_PARTNER_GAP = 96;
const GEN_STEP = TREE_GROWS_UP ? -GEN_H : GEN_H;

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

function coupleWidth(partnerRel: PartnerRelation): number {
  return partnerRel.second?.id ? PERSON_W * 2 + COUPLE_GAP : PERSON_W;
}

function partnershipBlockWidth(relations: Relation[], partnerRel: PartnerRelation): number {
  const kids = childrenOf(relations, partnerRel);
  const own = coupleWidth(partnerRel);
  if (kids.length === 0) return own;

  const kidsW =
    kids.reduce((sum, k) => sum + subtreeWidth(relations, k.person.id, partnerRel.id), 0) + GAP * Math.max(0, kids.length - 1);
  return Math.max(own, kidsW);
}

function subtreeWidth(relations: Relation[], personId: string, fromPartnershipId?: string): number {
  const partnerships = partnersOf(relations, personId, fromPartnershipId);
  if (partnerships.length === 0) return PERSON_W;

  return partnerships.reduce((sum, partnerRel, index) => {
    const block = partnershipBlockWidth(relations, partnerRel);
    return sum + block + (index > 0 ? MULTI_PARTNER_GAP : 0);
  }, 0);
}

/** Reuses person.id on first placement; later marriages get a duplicate card. */
function upsertPersonNode(
  nodes: Node[],
  placedPeople: Set<string>,
  person: Person,
  position: { x: number; y: number },
  partnerRelId?: string,
): string {
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

async function placePartnership(
  relations: Relation[],
  partnerRel: PartnerRelation,
  centerX: number,
  y: number,
  nodes: Node[],
  edges: Edge[],
  placedPeople: Set<string>,
  placedRelations: Set<string>,
  bloodRelativeId?: string,
) {
  if (placedRelations.has(partnerRel.id)) return;
  placedRelations.add(partnerRel.id);

  const first = await getPerson(partnerRel.first.id);
  const second = partnerRel.second?.id ? await getPerson(partnerRel.second.id) : null;

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
    data: {},
    draggable: true,
  });

  const leftNodeId = upsertPersonNode(nodes, placedPeople, left, { x: leftX, y }, partnerRel.id);
  addPartnerEdge(leftNodeId, partnerRel.id, "left", edges);

  let rightNodeId: string | null = null;
  if (right) {
    rightNodeId = upsertPersonNode(nodes, placedPeople, right, { x: rightX, y }, partnerRel.id);
    addPartnerEdge(rightNodeId, partnerRel.id, "right", edges);
  }

  const kids = childrenOf(relations, partnerRel);
  if (kids.length === 0) return;

  const kidsWithPeople = await Promise.all(
    kids.map(async (child) => ({
      child,
      person: await getPerson(child.person.id),
      side: sideOfKid(child, left.id, right?.id ?? null),
      width: subtreeWidth(relations, child.person.id, partnerRel.id),
    })),
  );

  const byBirth = (a: (typeof kidsWithPeople)[number], b: (typeof kidsWithPeople)[number]) => birthRank(a.person) - birthRank(b.person);
  const leftKids = kidsWithPeople.filter((k) => k.side === "left").sort(byBirth);
  const centerKids = kidsWithPeople.filter((k) => k.side === "center").sort(byBirth);
  const rightKids = kidsWithPeople.filter((k) => k.side === "right").sort(byBirth);

  const groupWidth = (group: typeof kidsWithPeople) =>
    group.length === 0 ? 0 : group.reduce((sum, k) => sum + k.width, 0) + GAP * (group.length - 1);

  const leftW = groupWidth(leftKids);
  const centerW = groupWidth(centerKids);

  const centerStart = centerX - centerW / 2;
  const leftStart = leftW > 0 ? centerStart - GAP - leftW : 0;
  const rightStart = centerW > 0 ? centerStart + centerW + GAP : centerX + COUPLE_GAP / 2 + PERSON_W / 2 + GAP;

  const childY = y + GEN_STEP;

  const placeGroup = async (group: typeof kidsWithPeople, startX: number) => {
    let cursor = startX;
    for (const { child, person, side, width: w } of group) {
      const slotLeft = cursor;
      const ownPartners = partnersOf(relations, child.person.id, partnerRel.id);

      if (ownPartners.length > 0) {
        let partnerCursor = slotLeft;
        for (const ownPartner of ownPartners) {
          const blockW = partnershipBlockWidth(relations, ownPartner);
          await placePartnership(
            relations,
            ownPartner,
            partnerCursor + blockW / 2,
            childY,
            nodes,
            edges,
            placedPeople,
            placedRelations,
            child.person.id,
          );
          partnerCursor += blockW + MULTI_PARTNER_GAP;
        }
      } else {
        upsertPersonNode(nodes, placedPeople, person, { x: slotLeft + (w - PERSON_W) / 2, y: childY });
      }

      if (side === "center") {
        addDescentEdge(partnerRel.id, child.person.id, "union", edges);
      } else {
        const parentNodeId = side === "left" ? leftNodeId : (rightNodeId ?? leftNodeId);
        addDescentEdge(parentNodeId, child.person.id, "direct", edges);
      }
      cursor += w + GAP;
    }
  };

  if (leftKids.length) await placeGroup(leftKids, leftStart);
  if (centerKids.length) await placeGroup(centerKids, centerStart);
  if (rightKids.length) await placeGroup(rightKids, rightStart);
}

export async function buildGenealogyGraph(relations: Relation[]): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const root = relations.find((r): r is PartnerRelation => isPartner(r) && r.root);
  if (!root) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  await placePartnership(relations, root, 0, 0, nodes, edges, new Set(), new Set());
  return { nodes, edges };
}
