import type { Edge, Node, NodeMouseHandler, OnNodeDrag, ReactFlowInstance, XYPosition } from "@xyflow/react";
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/firebase";
import { PERSON_H, PERSON_W, RELATION_SIZE } from "./genealogyLayout";

export const TREE_LAYOUT_ALGORITHM_VERSION = "genealogy-v6-branch-presets";

export type LayoutStatus = "persisted" | "dirty" | "rebased" | null;
export type LayoutMovementMode = "branch" | "node";

export type TreeLayoutPlacement = {
  key: string;
  nodeId: string;
  nodeType: "person" | "relation";
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  rootId: string | null;
  algorithmVersion: string;
  source: "person" | "partnership";
  groupRelationId: string | null;
};

type PlacementDraft = Map<string, TreeLayoutPlacement | null>;

type DragContext = {
  draggedId: string;
  draggedStart: XYPosition;
  groupRelationId: string | null;
  starts: Map<string, XYPosition>;
};

type StableNodeCacheEntry = {
  sourceNode: Node;
  node: Node;
  x: number;
  y: number;
  enabled: boolean;
  status: LayoutStatus;
  selected: boolean;
  collision: boolean;
  movementMode: LayoutMovementMode;
};

const COLLISION_PADDING = 12;
const WRITE_CHUNK_SIZE = 400;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePlacement(key: string, value: Record<string, unknown>): TreeLayoutPlacement | null {
  if (
    typeof value.nodeId !== "string" ||
    (value.nodeType !== "person" && value.nodeType !== "relation") ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.baseX) ||
    !isFiniteNumber(value.baseY)
  ) {
    return null;
  }

  return {
    key,
    nodeId: value.nodeId,
    nodeType: value.nodeType,
    x: value.x,
    y: value.y,
    baseX: value.baseX,
    baseY: value.baseY,
    rootId: typeof value.rootId === "string" ? value.rootId : null,
    algorithmVersion: typeof value.algorithmVersion === "string" ? value.algorithmVersion : TREE_LAYOUT_ALGORITHM_VERSION,
    source: value.source === "partnership" ? "partnership" : "person",
    groupRelationId: typeof value.groupRelationId === "string" ? value.groupRelationId : null,
  };
}

export function treeLayoutKey(node: Pick<Node, "id" | "type">): string {
  return `${node.type === "relation" ? "relation" : "person"}:${node.id}`;
}

function placementPosition(node: Node, placement: TreeLayoutPlacement, rootId: string | null): XYPosition {
  const matchesBase = placement.rootId === rootId && placement.algorithmVersion === TREE_LAYOUT_ALGORITHM_VERSION;
  if (matchesBase) return { x: placement.x, y: placement.y };

  return {
    x: node.position.x + (placement.x - placement.baseX),
    y: node.position.y + (placement.y - placement.baseY),
  };
}

function nodeSize(node: Node) {
  if (node.type === "person") {
    return {
      width: node.measured?.width ?? node.width ?? PERSON_W,
      height: node.measured?.height ?? node.height ?? PERSON_H,
    };
  }
  return {
    width: node.measured?.width ?? node.width ?? RELATION_SIZE,
    height: node.measured?.height ?? node.height ?? RELATION_SIZE,
  };
}

function findPersonCollisions(nodes: Node[]): { ids: Set<string>; count: number } {
  const people = nodes
    .filter((node) => node.type === "person")
    .map((node) => ({ node, ...nodeSize(node) }))
    .sort((first, second) => first.node.position.x - second.node.position.x);
  const ids = new Set<string>();
  let count = 0;

  for (let leftIndex = 0; leftIndex < people.length; leftIndex += 1) {
    const left = people[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < people.length; rightIndex += 1) {
      const right = people[rightIndex];
      if (right.node.position.x >= left.node.position.x + left.width + COLLISION_PADDING) break;

      const overlapsVertically =
        left.node.position.y < right.node.position.y + right.height + COLLISION_PADDING &&
        right.node.position.y < left.node.position.y + left.height + COLLISION_PADDING;
      if (!overlapsVertically) continue;

      ids.add(left.node.id);
      ids.add(right.node.id);
      count += 1;
    }
  }

  return { ids, count };
}

function branchGroupIds(startNodeId: string, nodes: Node[], edges: Edge[]): string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodesById.has(startNodeId)) return [];

  const outgoingEdges = new Map<string, Edge[]>();
  const partnersByRelation = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    const outgoing = outgoingEdges.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingEdges.set(edge.source, outgoing);
    if (edge.type === "partner") {
      const partners = partnersByRelation.get(edge.target) ?? [];
      partners.push(edge.source);
      partnersByRelation.set(edge.target, partners);
    }
  }

  const group = new Set<string>([startNodeId]);
  const expanded = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || expanded.has(nodeId)) continue;
    expanded.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;

    if (node.type === "relation") {
      for (const partnerId of partnersByRelation.get(nodeId) ?? []) group.add(partnerId);
      for (const edge of outgoingEdges.get(nodeId) ?? []) {
        if (edge.type !== "descent" || group.has(edge.target)) continue;
        group.add(edge.target);
        queue.push(edge.target);
      }
      continue;
    }

    for (const edge of outgoingEdges.get(nodeId) ?? []) {
      if (edge.type !== "descent" && edge.type !== "partner") continue;
      if (!group.has(edge.target)) group.add(edge.target);
      queue.push(edge.target);
    }
  }

  return [...group];
}

export function useTreeLayoutEditor(autoNodes: Node[], edges: Edge[], rootId: string | null, enabled: boolean) {
  const [persisted, setPersisted] = useState<Map<string, TreeLayoutPlacement>>(() => new Map());
  const [placementsReady, setPlacementsReady] = useState(false);
  const [draft, setDraft] = useState<PlacementDraft>(() => new Map());
  const [history, setHistory] = useState<PlacementDraft[]>(() => [new Map()]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [movementMode, setMovementMode] = useState<LayoutMovementMode>("branch");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragContext = useRef<DragContext | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const stableNodeCache = useRef<Map<string, StableNodeCacheEntry>>(new Map());

  useEffect(
    () =>
      onSnapshot(
        collection(db, "treeLayouts", "main", "placements"),
        (snapshot) => {
          const next = new Map<string, TreeLayoutPlacement>();
          for (const placementDocument of snapshot.docs) {
            const placement = normalizePlacement(placementDocument.id, placementDocument.data() as Record<string, unknown>);
            if (placement) next.set(placement.key, placement);
          }
          setPersisted(next);
          setPlacementsReady(true);
          setError(null);
        },
        (snapshotError) => {
          console.error("Listener ustawień układu został przerwany.", snapshotError);
          setPlacementsReady(true);
          setError("Nie udało się pobrać zapisanych ustawień układu.");
        },
      ),
    [],
  );

  useEffect(() => {
    if (enabled) return;
    dragContext.current = null;
    setSelectedNodeId(null);
  }, [enabled]);

  const commitDraft = useCallback(
    (nextDraft: PlacementDraft) => {
      const nextHistory = [...history.slice(0, historyIndex + 1), new Map(nextDraft)];
      setDraft(nextDraft);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      setError(null);
    },
    [history, historyIndex],
  );

  const onLayoutPointerDown = useCallback(
    (startNodeId: string) => {
      if (!enabled) return [];
      const instance = reactFlowInstance.current;
      if (!instance) return [];

      const currentNodes = instance.getNodes();
      const currentNode = currentNodes.find((node) => node.id === startNodeId);
      if (!currentNode) return [];

      const nodeIds = movementMode === "branch" ? branchGroupIds(startNodeId, currentNodes, edges) : [startNodeId];
      const selectedIds = new Set(nodeIds);
      const starts = new Map<string, XYPosition>();
      for (const node of currentNodes) {
        if (selectedIds.has(node.id)) starts.set(node.id, { ...node.position });
      }

      const draggedStart = starts.get(startNodeId);
      if (!draggedStart) return [];
      dragContext.current = {
        draggedId: startNodeId,
        draggedStart,
        groupRelationId: currentNode.type === "relation" ? currentNode.id : null,
        starts,
      };

      return nodeIds;
    },
    [edges, enabled, movementMode],
  );

  const positionedNodes = useMemo(() => {
    const positioned = autoNodes.map((node) => {
      const key = treeLayoutKey(node);
      const hasDraft = draft.has(key);
      const draftPlacement = draft.get(key);
      const savedPlacement = persisted.get(key);
      const placement = hasDraft ? draftPlacement : savedPlacement;
      const savedNeedsRebase =
        Boolean(savedPlacement) && (savedPlacement?.rootId !== rootId || savedPlacement.algorithmVersion !== TREE_LAYOUT_ALGORITHM_VERSION);
      const status: LayoutStatus = hasDraft ? "dirty" : savedPlacement ? (savedNeedsRebase ? "rebased" : "persisted") : null;
      const position = placement ? placementPosition(node, placement, rootId) : node.position;
      return {
        ...node,
        position,
        draggable: enabled,
        selectable: enabled,
        dragHandle: undefined,
        data: {
          ...node.data,
          layoutMode: enabled,
          layoutStatus: status,
          layoutSelected: enabled && selectedNodeId === node.id,
          layoutNodeId: node.id,
          onLayoutPointerDown: enabled ? onLayoutPointerDown : undefined,
        },
      };
    });
    const collisions = findPersonCollisions(positioned);

    const nextCache = new Map<string, StableNodeCacheEntry>();
    const stableNodes = positioned.map((node, index) => {
      const sourceNode = autoNodes[index];
      const collision = collisions.ids.has(node.id);
      const status = node.data.layoutStatus as LayoutStatus;
      const selected = node.data.layoutSelected === true;
      const previous = stableNodeCache.current.get(node.id);

      if (
        previous?.sourceNode === sourceNode &&
        previous.x === node.position.x &&
        previous.y === node.position.y &&
        previous.enabled === enabled &&
        previous.status === status &&
        previous.selected === selected &&
        previous.collision === collision &&
        previous.movementMode === movementMode
      ) {
        nextCache.set(node.id, previous);
        return previous.node;
      }

      const stableNode = {
        ...node,
        data: {
          ...node.data,
          layoutCollision: collision,
        },
      };
      nextCache.set(node.id, {
        sourceNode,
        node: stableNode,
        x: node.position.x,
        y: node.position.y,
        enabled,
        status,
        selected,
        collision,
        movementMode,
      });
      return stableNode;
    });
    stableNodeCache.current = nextCache;

    return {
      nodes: stableNodes,
      collisionCount: collisions.count,
    };
  }, [autoNodes, draft, enabled, movementMode, onLayoutPointerDown, persisted, rootId, selectedNodeId]);

  useEffect(() => {
    if (dragContext.current) return;
    reactFlowInstance.current?.setNodes(positionedNodes.nodes);
  }, [positionedNodes.nodes]);

  const onInit = useCallback((instance: unknown) => {
    reactFlowInstance.current = instance as ReactFlowInstance;
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (enabled) setSelectedNodeId(node.id);
    },
    [enabled],
  );

  const onNodeDragStart: OnNodeDrag = useCallback(
    (_event, node) => {
      if (!enabled) return;
      if (dragContext.current?.draggedId === node.id) return;

      const currentNodesById = new Map(positionedNodes.nodes.map((currentNode) => [currentNode.id, currentNode]));
      const groupRelationId = node.type === "relation" ? node.id : null;
      const nodeIds = movementMode === "branch" ? branchGroupIds(node.id, positionedNodes.nodes, edges) : [node.id];
      const starts = new Map<string, XYPosition>();

      for (const nodeId of nodeIds) {
        const currentNode = currentNodesById.get(nodeId);
        if (currentNode) starts.set(nodeId, { ...currentNode.position });
      }

      const draggedStart = starts.get(node.id);
      if (!draggedStart) return;
      dragContext.current = { draggedId: node.id, draggedStart, groupRelationId, starts };
    },
    [edges, enabled, movementMode, positionedNodes.nodes],
  );

  const onNodeDrag: OnNodeDrag = useCallback(() => {}, []);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      const context = dragContext.current;
      if (!enabled || !context || context.draggedId !== node.id) return;
      const deltaX = node.position.x - context.draggedStart.x;
      const deltaY = node.position.y - context.draggedStart.y;
      const autoNodesById = new Map(autoNodes.map((autoNode) => [autoNode.id, autoNode]));
      const nextDraft = new Map(draft);

      for (const [nodeId, start] of context.starts) {
        const autoNode = autoNodesById.get(nodeId);
        if (!autoNode) continue;
        const position = { x: start.x + deltaX, y: start.y + deltaY };
        const key = treeLayoutKey(autoNode);
        const isAtAutomaticPosition = Math.abs(position.x - autoNode.position.x) < 0.5 && Math.abs(position.y - autoNode.position.y) < 0.5;

        if (isAtAutomaticPosition) {
          if (persisted.has(key)) nextDraft.set(key, null);
          else nextDraft.delete(key);
          continue;
        }

        nextDraft.set(key, {
          key,
          nodeId,
          nodeType: autoNode.type === "relation" ? "relation" : "person",
          x: position.x,
          y: position.y,
          baseX: autoNode.position.x,
          baseY: autoNode.position.y,
          rootId,
          algorithmVersion: TREE_LAYOUT_ALGORITHM_VERSION,
          source: context.groupRelationId ? "partnership" : "person",
          groupRelationId: context.groupRelationId,
        });
      }

      dragContext.current = null;
      setSelectedNodeId(node.id);
      commitDraft(nextDraft);
    },
    [autoNodes, commitDraft, draft, enabled, persisted, rootId],
  );

  const undo = useCallback(() => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setDraft(new Map(history[nextIndex]));
    setError(null);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setDraft(new Map(history[nextIndex]));
    setError(null);
  }, [history, historyIndex]);

  const discard = useCallback(() => {
    setDraft(new Map());
    setHistory([new Map()]);
    setHistoryIndex(0);
    setError(null);
  }, []);

  const resetSelected = useCallback(() => {
    if (!selectedNodeId) return;
    const selectedNode = autoNodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return;
    const nodeIds = branchGroupIds(selectedNode.id, autoNodes, edges);
    const nextDraft = new Map(draft);

    for (const nodeId of nodeIds) {
      const currentNode = autoNodes.find((node) => node.id === nodeId);
      if (!currentNode) continue;
      const key = treeLayoutKey(currentNode);
      if (persisted.has(key)) nextDraft.set(key, null);
      else nextDraft.delete(key);
    }
    commitDraft(nextDraft);
  }, [autoNodes, commitDraft, draft, edges, persisted, selectedNodeId]);

  const resetAll = useCallback(() => {
    const nextDraft: PlacementDraft = new Map();
    for (const key of persisted.keys()) nextDraft.set(key, null);
    commitDraft(nextDraft);
  }, [commitDraft, persisted]);

  const save = useCallback(async () => {
    if (draft.size === 0 || saving) return true;
    if (positionedNodes.collisionCount > 0) {
      setError("Usuń kolizje kart przed zapisaniem układu.");
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const changes = [...draft.entries()];
      for (let offset = 0; offset < changes.length; offset += WRITE_CHUNK_SIZE) {
        const batch = writeBatch(db);
        for (const [key, placement] of changes.slice(offset, offset + WRITE_CHUNK_SIZE)) {
          const placementRef = doc(db, "treeLayouts", "main", "placements", key);
          if (placement) batch.set(placementRef, placement);
          else batch.delete(placementRef);
        }
        batch.set(
          doc(db, "treeLayouts", "main"),
          {
            rootId,
            algorithmVersion: TREE_LAYOUT_ALGORITHM_VERSION,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        await batch.commit();
      }

      setPersisted((current) => {
        const next = new Map(current);
        for (const [key, placement] of draft) {
          if (placement) next.set(key, placement);
          else next.delete(key);
        }
        return next;
      });
      discard();
      return true;
    } catch (saveError) {
      console.error("Nie udało się zapisać układu drzewa.", saveError);
      setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać układu drzewa.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [discard, draft, positionedNodes.collisionCount, rootId, saving]);

  return {
    nodes: positionedNodes.nodes,
    collisionCount: positionedNodes.collisionCount,
    dirtyCount: draft.size,
    persistedCount: persisted.size,
    placementsReady,
    selectedNodeId,
    movementMode,
    setMovementMode,
    saving,
    error,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    isDirty: draft.size > 0,
    onInit,
    onNodeClick,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    save,
    undo,
    redo,
    discard,
    resetSelected,
    resetAll,
  };
}
