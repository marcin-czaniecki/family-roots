import type { Edge, EdgeMouseHandler } from "@xyflow/react";
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DescentEdgeData } from "@/components/GenealogyEdges";
import { db } from "@/firebase";
import { type LayoutStatus, TREE_LAYOUT_ALGORITHM_VERSION } from "./useTreeLayoutEditor";

export type TreeEdgeRoute = {
  algorithmVersion: string;
  barOffset: number;
  baseBarOffset: number;
  edgeId: string;
  key: string;
  kind: "edge-route";
  rootId: string | null;
};

type EdgeRouteDraft = Map<string, TreeEdgeRoute | null>;

const WRITE_CHUNK_SIZE = 400;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function automaticBarOffset(edge: Edge): number {
  const data = edge.data as DescentEdgeData | undefined;
  return data?.barOffset ?? (data?.lane === "direct" ? 88 : 40);
}

function edgeRouteKey(edgeId: string): string {
  return `edge:${edgeId}`;
}

function normalizeRoute(key: string, value: Record<string, unknown>): TreeEdgeRoute | null {
  if (value.kind !== "edge-route" || typeof value.edgeId !== "string" || !isFiniteNumber(value.barOffset) || !isFiniteNumber(value.baseBarOffset)) {
    return null;
  }

  return {
    algorithmVersion: typeof value.algorithmVersion === "string" ? value.algorithmVersion : TREE_LAYOUT_ALGORITHM_VERSION,
    barOffset: value.barOffset,
    baseBarOffset: value.baseBarOffset,
    edgeId: value.edgeId,
    key,
    kind: "edge-route",
    rootId: typeof value.rootId === "string" ? value.rootId : null,
  };
}

function resolvedBarOffset(edge: Edge, route: TreeEdgeRoute, rootId: string | null): number {
  if (route.rootId === rootId && route.algorithmVersion === TREE_LAYOUT_ALGORITHM_VERSION) return route.barOffset;
  return automaticBarOffset(edge) + route.barOffset - route.baseBarOffset;
}

export function useTreeEdgeRoutes(edges: Edge[], rootId: string | null, enabled: boolean) {
  const [persisted, setPersisted] = useState<Map<string, TreeEdgeRoute>>(() => new Map());
  const [draft, setDraft] = useState<EdgeRouteDraft>(() => new Map());
  const [preview, setPreview] = useState<Map<string, number>>(() => new Map());
  const [history, setHistory] = useState<EdgeRouteDraft[]>(() => [new Map()]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, "treeLayouts", "main", "placements"),
        (snapshot) => {
          const next = new Map<string, TreeEdgeRoute>();
          for (const routeDocument of snapshot.docs) {
            const route = normalizeRoute(routeDocument.id, routeDocument.data() as Record<string, unknown>);
            if (route) next.set(route.key, route);
          }
          setPersisted(next);
          setError(null);
        },
        (snapshotError) => {
          console.error("Listener ustawień linii został przerwany.", snapshotError);
          setError("Nie udało się pobrać zapisanych ustawień linii.");
        },
      ),
    [],
  );

  useEffect(() => {
    if (enabled) return;
    setSelectedEdgeId(null);
    setPreview(new Map());
  }, [enabled]);

  useEffect(() => {
    if (!selectedEdgeId || edges.some((edge) => edge.id === selectedEdgeId && edge.type === "descent")) return;
    setSelectedEdgeId(null);
  }, [edges, selectedEdgeId]);

  const commitDraft = useCallback(
    (nextDraft: EdgeRouteDraft) => {
      const nextHistory = [...history.slice(0, historyIndex + 1), new Map(nextDraft)];
      setDraft(nextDraft);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      setError(null);
    },
    [history, historyIndex],
  );

  const onBendChange = useCallback((edgeId: string, barOffset: number) => {
    setPreview((current) => {
      const next = new Map(current);
      next.set(edgeId, barOffset);
      return next;
    });
  }, []);

  const onBendCommit = useCallback(
    (edgeId: string, barOffset: number) => {
      const edge = edges.find((candidate) => candidate.id === edgeId && candidate.type === "descent");
      if (!edge) return;
      const key = edgeRouteKey(edgeId);
      const automaticOffset = automaticBarOffset(edge);
      const finalOffset = Math.round(barOffset * 2) / 2;
      const nextDraft = new Map(draft);

      if (Math.abs(finalOffset - automaticOffset) < 0.5) {
        if (persisted.has(key)) nextDraft.set(key, null);
        else nextDraft.delete(key);
      } else {
        nextDraft.set(key, {
          algorithmVersion: TREE_LAYOUT_ALGORITHM_VERSION,
          barOffset: finalOffset,
          baseBarOffset: automaticOffset,
          edgeId,
          key,
          kind: "edge-route",
          rootId,
        });
      }

      setPreview((current) => {
        const next = new Map(current);
        next.delete(edgeId);
        return next;
      });
      commitDraft(nextDraft);
    },
    [commitDraft, draft, edges, persisted, rootId],
  );

  const routedEdges = useMemo(
    () =>
      edges.map((edge) => {
        if (edge.type !== "descent") return { ...edge, selectable: false };
        const key = edgeRouteKey(edge.id);
        const hasDraft = draft.has(key);
        const draftRoute = draft.get(key);
        const savedRoute = persisted.get(key);
        const route = hasDraft ? draftRoute : savedRoute;
        const savedNeedsRebase = Boolean(savedRoute) && (savedRoute?.rootId !== rootId || savedRoute.algorithmVersion !== TREE_LAYOUT_ALGORITHM_VERSION);
        const status: LayoutStatus = hasDraft ? "dirty" : savedRoute ? (savedNeedsRebase ? "rebased" : "persisted") : null;
        const barOffset = preview.get(edge.id) ?? (route ? resolvedBarOffset(edge, route, rootId) : automaticBarOffset(edge));

        return {
          ...edge,
          selected: enabled && selectedEdgeId === edge.id,
          selectable: enabled,
          data: {
            ...edge.data,
            barOffset,
            layoutMode: enabled,
            layoutStatus: status,
            onBendChange,
            onBendCommit,
          },
        };
      }),
    [draft, edges, enabled, onBendChange, onBendCommit, persisted, preview, rootId, selectedEdgeId],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      if (enabled && edge.type === "descent") setSelectedEdgeId(edge.id);
    },
    [enabled],
  );

  const clearSelection = useCallback(() => setSelectedEdgeId(null), []);

  const undo = useCallback(() => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setDraft(new Map(history[nextIndex]));
    setPreview(new Map());
    setError(null);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setDraft(new Map(history[nextIndex]));
    setPreview(new Map());
    setError(null);
  }, [history, historyIndex]);

  const discard = useCallback(() => {
    setDraft(new Map());
    setPreview(new Map());
    setHistory([new Map()]);
    setHistoryIndex(0);
    setError(null);
  }, []);

  const resetSelected = useCallback(() => {
    if (!selectedEdgeId) return;
    const key = edgeRouteKey(selectedEdgeId);
    const nextDraft = new Map(draft);
    if (persisted.has(key)) nextDraft.set(key, null);
    else nextDraft.delete(key);
    setPreview((current) => {
      const next = new Map(current);
      next.delete(selectedEdgeId);
      return next;
    });
    commitDraft(nextDraft);
  }, [commitDraft, draft, persisted, selectedEdgeId]);

  const resetAll = useCallback(() => {
    const nextDraft: EdgeRouteDraft = new Map();
    for (const key of persisted.keys()) nextDraft.set(key, null);
    commitDraft(nextDraft);
  }, [commitDraft, persisted]);

  const save = useCallback(async () => {
    if (draft.size === 0 || saving) return true;
    setSaving(true);
    setError(null);
    try {
      const changes = [...draft.entries()];
      for (let offset = 0; offset < changes.length; offset += WRITE_CHUNK_SIZE) {
        const batch = writeBatch(db);
        for (const [key, route] of changes.slice(offset, offset + WRITE_CHUNK_SIZE)) {
          const routeRef = doc(db, "treeLayouts", "main", "placements", key);
          if (route) batch.set(routeRef, route);
          else batch.delete(routeRef);
        }
        batch.set(doc(db, "treeLayouts", "main"), { rootId, algorithmVersion: TREE_LAYOUT_ALGORITHM_VERSION, updatedAt: serverTimestamp() }, { merge: true });
        await batch.commit();
      }

      setPersisted((current) => {
        const next = new Map(current);
        for (const [key, route] of draft) {
          if (route) next.set(key, route);
          else next.delete(key);
        }
        return next;
      });
      discard();
      return true;
    } catch (saveError) {
      console.error("Nie udało się zapisać ustawień linii.", saveError);
      setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać ustawień linii.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [discard, draft, rootId, saving]);

  return {
    edges: routedEdges,
    selectedEdgeId,
    clearSelection,
    onEdgeClick,
    resetSelected,
    resetAll,
    save,
    undo,
    redo,
    discard,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    dirtyCount: draft.size,
    persistedCount: persisted.size,
    isDirty: draft.size > 0,
    saving,
    error,
  };
}
