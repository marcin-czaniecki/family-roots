import {
  addEdge,
  Background,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { DescentEdge, type DescentEdgeData, PartnerEdge } from "@/components/GenealogyEdges";
import { PersonNode } from "@/components/PersonNode";
import { RelationNode } from "@/components/RelationNode";
import { getPerson } from "@/entities/person/getPerson";
import type { Person } from "@/entities/person/types";
import type { ParentRelation, PartnerRelation, Relation } from "@/entities/relation/types";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useState } from "react";
import { useLoaderData } from "react-router";

const nodeTypes = {
  person: PersonNode,
  relation: RelationNode,
};

const edgeTypes = {
  partner: PartnerEdge,
  descent: DescentEdge,
} satisfies EdgeTypes;

type PersonNodeData = Person & Record<string, unknown>;
type PersonFlowNode = Node<PersonNodeData, "person">;

const PERSON_W = 168;
const PERSON_H = 268;
const RELATION_SIZE = 14;
const GAP = 64;
const GEN_H = 400;
const COUPLE_GAP = 40;

const getPersonNode = (person: Person, position: { x: number; y: number }): PersonFlowNode => ({
  id: person.id,
  type: "person",
  position,
  data: person as PersonNodeData,
  draggable: true,
});

function isPartner(r: Relation): r is PartnerRelation {
  return r.type === "partner";
}

function isParent(r: Relation): r is ParentRelation {
  return r.type === "parent";
}

function hasParentship(r: ParentRelation): boolean {
  return Boolean(r.parentship?.id);
}

function childrenOf(relations: Relation[], partnerRel: PartnerRelation): ParentRelation[] {
  return relations.filter((r): r is ParentRelation => {
    if (!isParent(r)) return false;
    if (r.parentship?.id === partnerRel.id) return true;
    if (!hasParentship(r)) {
      const parents = new Set([partnerRel.first.id, partnerRel.second?.id].filter(Boolean) as string[]);
      const linked = [r.first?.id, r.second?.id].filter(Boolean) as string[];
      return linked.length > 0 && linked.every((id) => parents.has(id));
    }
    return false;
  });
}

function partnerOf(relations: Relation[], personId: string, excludeRelationId?: string) {
  return relations.find(
    (r): r is PartnerRelation =>
      isPartner(r) && r.id !== excludeRelationId && (r.first.id === personId || r.second?.id === personId),
  );
}

function birthRank(person: Person): number {
  const y = person.birth?.year ?? 9999;
  const m = person.birth?.month ?? 12;
  const d = person.birth?.day ?? 31;
  return y * 10000 + m * 100 + d;
}

function coupleWidth(partnerRel: PartnerRelation): number {
  return partnerRel.second?.id ? PERSON_W * 2 + COUPLE_GAP : PERSON_W;
}

function subtreeWidth(relations: Relation[], personId: string, fromPartnershipId?: string): number {
  const partnerRel = partnerOf(relations, personId, fromPartnershipId);
  if (!partnerRel) return PERSON_W;

  const kids = childrenOf(relations, partnerRel);
  const own = coupleWidth(partnerRel);
  if (kids.length === 0) return own;

  const kidsW =
    kids.reduce((sum, k) => sum + subtreeWidth(relations, k.person.id, partnerRel.id), 0) + GAP * Math.max(0, kids.length - 1);
  return Math.max(own, kidsW);
}

function upsertPersonNode(nodes: Node[], placedPeople: Set<string>, person: Person, position: { x: number; y: number }) {
  if (placedPeople.has(person.id)) {
    const existing = nodes.find((node) => node.id === person.id);
    if (existing) existing.position = position;
    return;
  }
  placedPeople.add(person.id);
  nodes.push(getPersonNode(person, position));
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

/** Which side of the couple a child belongs to: linked only to the left parent → left, only to the right → right, couple's child → center. */
function sideOfKid(child: ParentRelation, leftParentId: string, rightParentId: string | null): "left" | "center" | "right" {
  if (hasParentship(child)) return "center";
  const linked = [child.first?.id, child.second?.id].filter(Boolean) as string[];
  const linksLeft = linked.includes(leftParentId);
  const linksRight = rightParentId ? linked.includes(rightParentId) : false;
  if (linksLeft && !linksRight) return "left";
  if (linksRight && !linksLeft) return "right";
  return "center";
}

function addPartnerEdge(personId: string, relationId: string, side: "left" | "right", edges: Edge[]) {
  const sourceHandle = side === "left" ? "partner-first" : "partner-second";
  const targetHandle = side === "left" ? "partner-first" : "partner-second";
  edges.push({
    id: `${personId}->${relationId}`,
    source: personId,
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
  /** Blood relative stays on the left (toward siblings); spouse on the right. */
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

  upsertPersonNode(nodes, placedPeople, left, { x: leftX, y });
  addPartnerEdge(left.id, partnerRel.id, "left", edges);

  if (right) {
    upsertPersonNode(nodes, placedPeople, right, { x: rightX, y });
    addPartnerEdge(right.id, partnerRel.id, "right", edges);
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

  // Couple's children centered under the union; single-parent kids flank them.
  const centerStart = centerX - centerW / 2;
  const leftStart = leftW > 0 ? centerStart - GAP - leftW : 0;
  const rightStart = centerW > 0 ? centerStart + centerW + GAP : centerX + COUPLE_GAP / 2 + PERSON_W / 2 + GAP;

  const childY = y + GEN_H;

  const placeGroup = async (group: typeof kidsWithPeople, startX: number) => {
    let cursor = startX;
    for (const { child, person, side, width: w } of group) {
      const slotLeft = cursor;
      const ownPartner = partnerOf(relations, child.person.id, partnerRel.id);

      if (ownPartner) {
        const coupleW = coupleWidth(ownPartner);
        const coupleCenter = slotLeft + coupleW / 2;
        await placePartnership(
          relations,
          ownPartner,
          coupleCenter,
          childY,
          nodes,
          edges,
          placedPeople,
          placedRelations,
          child.person.id,
        );
      } else {
        upsertPersonNode(nodes, placedPeople, person, { x: slotLeft + (w - PERSON_W) / 2, y: childY });
      }

      if (side === "center") {
        addDescentEdge(partnerRel.id, child.person.id, "union", edges);
      } else {
        const parentPersonId = side === "left" ? left.id : (right?.id ?? left.id);
        addDescentEdge(parentPersonId, child.person.id, "direct", edges);
      }
      cursor += w + GAP;
    }
  };

  if (leftKids.length) await placeGroup(leftKids, leftStart);
  if (centerKids.length) await placeGroup(centerKids, centerStart);
  if (rightKids.length) await placeGroup(rightKids, rightStart);
}

function FitToTop({ ready }: { ready: boolean }) {
  const { getNodes, setViewport } = useReactFlow();

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const current = getNodes();
      if (current.length === 0) return;
      const minX = Math.min(...current.map((n) => n.position.x));
      const minY = Math.min(...current.map((n) => n.position.y));
      setViewport({ x: -minX + 64, y: -minY + 40, zoom: 0.82 }, { duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, getNodes, setViewport]);

  return null;
}

export function Home() {
  const relations = useLoaderData<Relation[]>();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    (async () => {
      const root = relations.find((r): r is PartnerRelation => isPartner(r) && r.root);
      if (!root) return;
      const nextNodes: Node[] = [];
      const nextEdges: Edge[] = [];
      await placePartnership(relations, root, 0, 0, nextNodes, nextEdges, new Set(), new Set());
      setNodes(nextNodes);
      setEdges(nextEdges);
    })();
  }, [relations]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((edgesSnapshot) => addEdge({ ...params, type: "descent" }, edgesSnapshot)),
    [],
  );

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#f3efe8" }}>
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        onConnect={onConnect}
        colorMode="light"
        defaultEdgeOptions={{ zIndex: 2, style: { stroke: "#8a735a", strokeWidth: 1.6 } }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
        style={{ ["--xy-edge-stroke" as string]: "#8a735a" }}
      >
        <FitToTop ready={nodes.length > 0} />
        <Background color="#d5cbb8" gap={28} size={1} />
        <style>{`
          .react-flow__viewport .react-flow__edges {
            z-index: 5 !important;
          }
          .react-flow__viewport .react-flow__nodes {
            z-index: 3 !important;
          }
          .react-flow__edge-path {
            stroke-linecap: square;
            pointer-events: none;
          }
        `}</style>
      </ReactFlow>
    </div>
  );
}
