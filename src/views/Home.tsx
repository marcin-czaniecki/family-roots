import { Background, type Edge, type Node, type OnConnectEnd, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { AlertTriangle, Download, Eye, Move, Network, Pencil, PinOff, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import styled from "styled-components";
import { FitToTop } from "@/components/FitToTop";
import { PersonFormFields } from "@/components/PersonFormFields";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { matchesPersonQuery, personDatesOrId, personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";
import type { ParentRelation, PartnerRelation, Relation, TreeLayoutPreset } from "@/entities/relation/types";
import { useAuth } from "@/features/auth/AuthProvider";
import { downloadGenealogyPng } from "@/features/exportGenealogyPng";
import { DEFAULT_TREE_LAYOUT_PRESET, edgeTypes, nodeTypes, TREE_LAYOUT_PRESET_OPTIONS } from "@/features/genealogyLayout";
import { deletePersonWithRelations, getPersonDeletionImpact } from "@/features/personDeletion";
import { emptyPersonForm, type PersonFormValues, personFormPayload, personToForm, validatePersonForm } from "@/features/personForm";
import { deleteRelationWithDependents, getRelationDeletionImpact } from "@/features/relationDeletion";
import { useGenealogyRealtime } from "@/features/useGenealogyRealtime";
import { useTreeEdgeRoutes } from "@/features/useTreeEdgeRoutes";
import { useTreeLayoutEditor } from "@/features/useTreeLayoutEditor";
import { db } from "@/firebase";

import "@xyflow/react/dist/style.css";

type GenealogyLoaderData = {
  nodes: Node[];
  edges: Edge[];
  people: Person[];
  relations: Relation[];
};

const SEARCH_PAGE_SIZE = 6;
const DEFAULT_RELATION_COLOR = "#3d5a4c";
type InteractionMode = "view" | "data" | "layout";

type RelationTarget = ({ mode: "existing"; personId: string } | { mode: "new"; person: PersonFormValues }) & { color: string | null };

type RelationDraft =
  | {
      id: string;
      kind: "partner";
      sourcePersonId: string;
      sourcePersonName: string;
      sourceRole: "first" | "second";
      preselectedPersonId: string;
    }
  | {
      id: string;
      kind: "parent";
      firstId: string;
      secondId: string | null;
      parentshipId: string | null;
      sourceLabel: string;
      preselectedPersonId: string;
    };

function relationPersonLabel(personId: string, peopleById: Map<string, Person>) {
  const person = peopleById.get(personId);
  return person ? personName(person) : personId;
}

export function Home() {
  const { user } = useAuth();
  const canEdit = Boolean(user);
  const { nodes: loadedNodes, edges: loadedEdges, people: loadedPeople, relations: loadedRelations } = useLoaderData<GenealogyLoaderData>();
  const [autoLayoutPreset, setAutoLayoutPreset] = useState<TreeLayoutPreset>(DEFAULT_TREE_LAYOUT_PRESET);
  const { graph, people, relations } = useGenealogyRealtime(
    { people: loadedPeople, relations: loadedRelations },
    { nodes: loadedNodes, edges: loadedEdges },
    autoLayoutPreset,
  );
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("view");
  const [showBirthSurname, setShowBirthSurname] = useState(false);
  const [lineEditMode, setLineEditMode] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportPngError, setExportPngError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RelationDraft | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const openPersonEditor = useCallback((person: Person) => {
    setDraft(null);
    setEditingPerson(person);
  }, []);
  const dataEditMode = canEdit && interactionMode === "data";
  const layoutEditMode = canEdit && interactionMode === "layout";

  useEffect(() => {
    if (canEdit || interactionMode === "view") return;
    setDraft(null);
    setEditingPerson(null);
    setInteractionMode("view");
  }, [canEdit, interactionMode]);
  const rootId = useMemo(() => graph.nodes.find((node) => node.data.root === true)?.id ?? null, [graph.nodes]);
  const automaticDiagramNodes = useMemo(
    () =>
      graph.nodes.map((node) =>
        node.type === "person"
          ? {
              ...node,
              data: { ...node.data, editMode: dataEditMode, onEdit: openPersonEditor, showBirthSurname },
            }
          : node,
      ),
    [dataEditMode, graph.nodes, openPersonEditor, showBirthSurname],
  );
  const layout = useTreeLayoutEditor(automaticDiagramNodes, graph.edges, rootId, layoutEditMode);
  const edgeLayout = useTreeEdgeRoutes(graph.edges, rootId, layoutEditMode && lineEditMode);
  const diagramNodes = layout.nodes;
  const downloadTreePng = useCallback(async () => {
    if (exportingPng) return;
    const viewport = canvasRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport) {
      setExportPngError("Nie udało się znaleźć drzewa do zapisania.");
      return;
    }

    setExportingPng(true);
    setExportPngError(null);
    try {
      await downloadGenealogyPng(viewport, diagramNodes);
    } catch (error) {
      console.error("Nie udało się pobrać drzewa jako PNG.", error);
      setExportPngError(error instanceof Error ? error.message : "Nie udało się pobrać drzewa jako PNG.");
    } finally {
      setExportingPng(false);
    }
  }, [diagramNodes, exportingPng]);
  const [layoutRelationId, setLayoutRelationId] = useState(() => loadedRelations.find((relation) => relation.root)?.id ?? loadedRelations[0]?.id ?? "");
  const [savingRelationPreset, setSavingRelationPreset] = useState(false);
  const [relationPresetError, setRelationPresetError] = useState<string | null>(null);
  const layoutRelationOptions = useMemo(
    () =>
      relations
        .map((relation) => {
          const label =
            relation.type === "partner"
              ? `${relationPersonLabel(relation.first.id, peopleById)} + ${relation.second?.id ? relationPersonLabel(relation.second.id, peopleById) : "nieznany partner"}`
              : `${[relation.first.id, relation.second?.id]
                  .filter((personId): personId is string => Boolean(personId))
                  .map((personId) => relationPersonLabel(personId, peopleById))
                  .join(" + ")} → ${relationPersonLabel(relation.person.id, peopleById)}`;
          return { id: relation.id, label, root: relation.root, type: relation.type };
        })
        .sort((first, second) => Number(second.root) - Number(first.root) || first.label.localeCompare(second.label, "pl")),
    [peopleById, relations],
  );
  const selectedLayoutRelation = relations.find((relation) => relation.id === layoutRelationId) ?? null;

  useEffect(() => {
    const clickedRelation = relations.find((relation) => relation.id === layout.selectedNodeId);
    if (clickedRelation) {
      setLayoutRelationId(clickedRelation.id);
      return;
    }
    setLayoutRelationId((current) =>
      relations.some((relation) => relation.id === current) ? current : (relations.find((relation) => relation.root)?.id ?? relations[0]?.id ?? ""),
    );
  }, [layout.selectedNodeId, relations]);

  const updateRelationLayoutPreset = async (value: TreeLayoutPreset | "inherit") => {
    if (!selectedLayoutRelation || savingRelationPreset) return;
    setSavingRelationPreset(true);
    setRelationPresetError(null);
    try {
      await updateDoc(doc(db, "relations", selectedLayoutRelation.id), {
        layoutPreset: value === "inherit" ? null : value,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setRelationPresetError(error instanceof Error ? error.message : "Nie udało się zapisać układu relacji.");
    } finally {
      setSavingRelationPreset(false);
    }
  };

  const changeInteractionMode = (nextMode: InteractionMode) => {
    if (nextMode !== "view" && !canEdit) return;
    if (nextMode === interactionMode) return;
    if (interactionMode === "layout" && (layout.isDirty || edgeLayout.isDirty)) {
      const discard = window.confirm("Masz niezapisane zmiany układu. Odrzucić je i zmienić tryb?");
      if (!discard) return;
      layout.discard();
      edgeLayout.discard();
    }
    if (nextMode !== "data") {
      setDraft(null);
      setEditingPerson(null);
    }
    setInteractionMode(nextMode);
  };

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      if (!dataEditMode || !connectionState.fromNode || !connectionState.fromHandle || connectionState.fromHandle.type !== "source") return;

      const sourceNode = connectionState.fromNode;
      const handleId = connectionState.fromHandle.id;
      const targetPerson = connectionState.toNode?.type === "person" ? (connectionState.toNode.data as unknown as Person) : null;
      const preselectedPersonId = targetPerson?.id ?? "";
      const draftId = `${sourceNode.id}:${handleId ?? "handle"}:${Date.now()}`;

      if (sourceNode.type === "person" && (handleId === "partner-first" || handleId === "partner-second")) {
        const sourcePerson = sourceNode.data as unknown as Person;
        setDraft({
          id: draftId,
          kind: "partner",
          sourcePersonId: sourcePerson.id,
          sourcePersonName: personName(sourcePerson),
          sourceRole: handleId === "partner-first" ? "first" : "second",
          preselectedPersonId,
        });
        return;
      }

      if (handleId !== "child") return;

      if (sourceNode.type === "person") {
        const sourcePerson = sourceNode.data as unknown as Person;
        setDraft({
          id: draftId,
          kind: "parent",
          firstId: sourcePerson.id,
          secondId: null,
          parentshipId: null,
          sourceLabel: personName(sourcePerson),
          preselectedPersonId,
        });
        return;
      }

      if (sourceNode.type === "relation") {
        const partnership = relations.find((relation): relation is PartnerRelation => relation.type === "partner" && relation.id === sourceNode.id);
        if (!partnership) return;
        const firstLabel = relationPersonLabel(partnership.first.id, peopleById);
        const secondLabel = partnership.second?.id ? relationPersonLabel(partnership.second.id, peopleById) : null;
        setDraft({
          id: draftId,
          kind: "parent",
          firstId: partnership.first.id,
          secondId: partnership.second?.id ?? null,
          parentshipId: partnership.id,
          sourceLabel: [firstLabel, secondLabel].filter(Boolean).join(" i "),
          preselectedPersonId,
        });
      }
    },
    [dataEditMode, peopleById, relations],
  );

  const saveRelation = async (activeDraft: RelationDraft, target: RelationTarget) => {
    const batch = writeBatch(db);
    const personRef = target.mode === "existing" ? doc(db, "people", target.personId) : doc(collection(db, "people"));
    const relationRef = doc(collection(db, "relations"));

    if (target.mode === "new") {
      batch.set(personRef, {
        ...personFormPayload(target.person),
        father: null,
        mother: null,
        createdAt: serverTimestamp(),
      });
    }

    if (activeDraft.kind === "partner") {
      if (personRef.id === activeDraft.sourcePersonId) throw new Error("Nie można utworzyć relacji partnerskiej osoby z samą sobą.");
      const duplicate = relations.some(
        (relation) =>
          relation.type === "partner" &&
          ((relation.first.id === activeDraft.sourcePersonId && relation.second?.id === personRef.id) ||
            (relation.first.id === personRef.id && relation.second?.id === activeDraft.sourcePersonId)),
      );
      if (duplicate) throw new Error("Taka relacja partnerska już istnieje.");

      const sourceRef = doc(db, "people", activeDraft.sourcePersonId);
      const first = activeDraft.sourceRole === "first" ? sourceRef : personRef;
      const second = activeDraft.sourceRole === "first" ? personRef : sourceRef;
      batch.set(relationRef, { type: "partner", color: target.color, first, second, root: false });
    } else {
      if (personRef.id === activeDraft.firstId || personRef.id === activeDraft.secondId) {
        throw new Error("Osoba nie może być własnym dzieckiem.");
      }
      const parentIds = [activeDraft.firstId, activeDraft.secondId].filter(Boolean).sort();
      const duplicate = relations.some((relation) => {
        if (relation.type !== "parent" || relation.person.id !== personRef.id) return false;
        if (activeDraft.parentshipId) return relation.parentship?.id === activeDraft.parentshipId;
        return [relation.first.id, relation.second?.id ?? null].filter(Boolean).sort().join(":") === parentIds.join(":");
      });
      if (duplicate) throw new Error("Taka relacja rodzic–dziecko już istnieje.");

      const first = doc(db, "people", activeDraft.firstId);
      const second = activeDraft.secondId ? doc(db, "people", activeDraft.secondId) : null;
      const parentship = activeDraft.parentshipId ? doc(db, "relations", activeDraft.parentshipId) : null;

      batch.set(relationRef, { type: "parent", color: target.color, first, second, person: personRef, parentship, root: false });
    }

    await batch.commit();
    setDraft(null);
  };
  const savePerson = async (personId: string, values: PersonFormValues) => {
    await updateDoc(doc(db, "people", personId), {
      ...personFormPayload(values),
      updatedAt: serverTimestamp(),
    });
    setEditingPerson(null);
  };
  const updateRelationWithRoot = async (relation: Relation, root: boolean, values: Record<string, unknown>) => {
    if (relation.root && !root) {
      throw new Error("Nie można usunąć jedynego punktu startowego. Ustaw inną relację jako root, aby go przenieść.");
    }

    const batch = writeBatch(db);
    if (root) {
      for (const currentRoot of relations.filter((candidate) => candidate.root && candidate.id !== relation.id)) {
        batch.update(doc(db, "relations", currentRoot.id), { root: false });
      }
    }
    batch.update(doc(db, "relations", relation.id), { ...values, root });
    await batch.commit();
  };
  const saveParentRelation = async (relation: ParentRelation, secondParentId: string, color: string | null, root: boolean) => {
    const parentship = secondParentId
      ? relations
          .filter(
            (candidate): candidate is PartnerRelation =>
              candidate.type === "partner" &&
              ((candidate.first.id === relation.first.id && candidate.second?.id === secondParentId) ||
                (candidate.first.id === secondParentId && candidate.second?.id === relation.first.id)),
          )
          .sort((first, second) => first.id.localeCompare(second.id))[0]
      : null;

    if (root && secondParentId) {
      throw new Error("Relacja parent może być rootem tylko wtedy, gdy ma jednego znanego rodzica i nie ma parentship.");
    }

    await updateRelationWithRoot(relation, root, {
      color,
      second: secondParentId ? doc(db, "people", secondParentId) : null,
      parentship: parentship ? doc(db, "relations", parentship.id) : null,
    });
  };
  const savePartnerRelation = async (relation: PartnerRelation, color: string | null, root: boolean) => {
    await updateRelationWithRoot(relation, root, { color });
  };
  const deleteRelation = async (relation: Relation) => {
    await deleteRelationWithDependents(relation, relations);
  };
  const deletePerson = async (person: Person) => {
    const impact = getPersonDeletionImpact(person, people, relations);
    const details = [
      `Relacje do usunięcia: ${impact.relationsToDelete}.`,
      `Relacje do aktualizacji: ${impact.relationsToUpdate}.`,
      `Pola rodziców do wyczyszczenia: ${impact.parentLinksToClear}.`,
    ].join("\n");
    const rootWarning = impact.deletesRootRelation ? "\n\nUwaga: wraz z osobą zostanie usunięta relacja root drzewa." : "";

    if (!window.confirm(`Usunąć osobę „${personName(person)}”?\n\n${details}${rootWarning}\n\nTej operacji nie można cofnąć.`)) return;

    await deletePersonWithRelations(person, people, relations);
    setEditingPerson(null);
  };
  const layoutIsDirty = layout.isDirty || edgeLayout.isDirty;
  const layoutSaving = layout.saving || edgeLayout.saving;
  const layoutDirtyCount = layout.dirtyCount + edgeLayout.dirtyCount;
  const layoutPersistedCount = layout.persistedCount + edgeLayout.persistedCount;
  const edgeSelected = Boolean(edgeLayout.selectedEdgeId);
  const saveTreeLayout = async () => {
    const nodesSaved = await layout.save();
    if (!nodesSaved) return false;
    return edgeLayout.save();
  };
  const discardTreeLayout = () => {
    layout.discard();
    edgeLayout.discard();
  };
  const resetAllTreeLayout = () => {
    layout.resetAll();
    edgeLayout.resetAll();
  };
  return (
    <Canvas ref={canvasRef}>
      <ReactFlow
        className={`genealogy-flow${dataEditMode ? " is-editing" : ""}${layoutEditMode ? " is-layout-editing" : ""}`}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultNodes={diagramNodes}
        edges={edgeLayout.edges}
        nodesDraggable={layoutEditMode}
        nodesConnectable={dataEditMode}
        elementsSelectable={layoutEditMode}
        snapToGrid={layoutEditMode}
        snapGrid={[16, 16]}
        connectOnClick={false}
        onConnectEnd={onConnectEnd}
        onInit={layout.onInit}
        onNodeClick={(event, node) => {
          edgeLayout.clearSelection();
          layout.onNodeClick(event, node);
        }}
        onEdgeClick={edgeLayout.onEdgeClick}
        onNodeDragStart={layout.onNodeDragStart}
        onNodeDrag={layout.onNodeDrag}
        onNodeDragStop={layout.onNodeDragStop}
        colorMode="light"
        connectionLineStyle={{ stroke: "#3d5a4c", strokeWidth: 2 }}
        defaultEdgeOptions={{ zIndex: 2, style: { stroke: "#8a735a", strokeWidth: 1.6 } }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
        style={{ ["--xy-edge-stroke" as string]: "#8a735a" }}
      >
        <FitToTop key={autoLayoutPreset} ready={graph.nodes.length > 0 && layout.placementsReady} />
        <Background color="#d5cbb8" gap={28} size={1} />
        <DiagramPersonSearch nodes={graph.nodes} />
        {layoutEditMode ? (
          <Panel position="top-right">
            <AutomaticLayoutPanel className="nodrag nopan nowheel">
              <AutomaticLayoutHeader>
                <Network size={18} aria-hidden="true" />
                <span>Automatyczny układ</span>
              </AutomaticLayoutHeader>
              <AutomaticLayoutField>
                <AutomaticLayoutLabel htmlFor="layout-movement-mode">Przeciąganie</AutomaticLayoutLabel>
                <AutomaticLayoutMovementControl>
                  <ModeInput
                    id="layout-movement-mode"
                    type="checkbox"
                    checked={layout.movementMode === "node"}
                    onChange={(event) => layout.setMovementMode(event.target.checked ? "node" : "branch")}
                  />
                  <ModeTrack aria-hidden="true" />
                  <AutomaticLayoutMovementValue>{layout.movementMode === "branch" ? "Cała gałąź" : "Tylko kafelek"}</AutomaticLayoutMovementValue>
                </AutomaticLayoutMovementControl>
              </AutomaticLayoutField>
              <AutomaticLayoutField>
                <AutomaticLayoutLabel htmlFor="layout-line-mode">Linie</AutomaticLayoutLabel>
                <AutomaticLayoutMovementControl>
                  <ModeInput id="layout-line-mode" type="checkbox" checked={lineEditMode} onChange={(event) => setLineEditMode(event.target.checked)} />
                  <ModeTrack aria-hidden="true" />
                  <AutomaticLayoutMovementValue>{lineEditMode ? "Ręczne zgięcia" : "Automatyczne"}</AutomaticLayoutMovementValue>
                </AutomaticLayoutMovementControl>
              </AutomaticLayoutField>
              <AutomaticLayoutField>
                <AutomaticLayoutLabel htmlFor="tree-layout-preset">Całe drzewo</AutomaticLayoutLabel>
                <AutomaticLayoutSelect
                  id="tree-layout-preset"
                  value={autoLayoutPreset}
                  onChange={(event) => setAutoLayoutPreset(event.target.value as TreeLayoutPreset)}
                >
                  {TREE_LAYOUT_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </AutomaticLayoutSelect>
              </AutomaticLayoutField>
              <AutomaticLayoutDivider />
              <AutomaticLayoutField>
                <AutomaticLayoutLabel htmlFor="relation-layout-target">Relacja</AutomaticLayoutLabel>
                <AutomaticLayoutSelect
                  id="relation-layout-target"
                  value={layoutRelationId}
                  onChange={(event) => {
                    setLayoutRelationId(event.target.value);
                    setRelationPresetError(null);
                  }}
                  disabled={layoutRelationOptions.length === 0}
                >
                  {layoutRelationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.root ? "[root] " : ""}
                      {option.label}
                    </option>
                  ))}
                </AutomaticLayoutSelect>
              </AutomaticLayoutField>
              <AutomaticLayoutField>
                <AutomaticLayoutLabel htmlFor="relation-layout-preset">Układ gałęzi</AutomaticLayoutLabel>
                <AutomaticLayoutSelect
                  id="relation-layout-preset"
                  value={selectedLayoutRelation?.layoutPreset ?? "inherit"}
                  disabled={!selectedLayoutRelation || savingRelationPreset}
                  onChange={(event) => void updateRelationLayoutPreset(event.target.value as TreeLayoutPreset | "inherit")}
                >
                  <option value="inherit">Dziedzicz z drzewa</option>
                  {TREE_LAYOUT_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </AutomaticLayoutSelect>
              </AutomaticLayoutField>
              {savingRelationPreset ? <AutomaticLayoutStatus>Zapisywanie…</AutomaticLayoutStatus> : null}
              {relationPresetError ? <AutomaticLayoutError>{relationPresetError}</AutomaticLayoutError> : null}
            </AutomaticLayoutPanel>
          </Panel>
        ) : null}
        <Panel position="bottom-left">
          <ModeControls className="nodrag nopan">
            {canEdit ? (
              <ModeSwitcher aria-label="Tryb pracy">
                <ModeButton type="button" $active={interactionMode === "view"} onClick={() => changeInteractionMode("view")}>
                  <Eye size={16} aria-hidden="true" />
                  <span>Podgląd</span>
                </ModeButton>
                <ModeButton type="button" $active={interactionMode === "data"} onClick={() => changeInteractionMode("data")}>
                  <Pencil size={16} aria-hidden="true" />
                  <span>Dane</span>
                </ModeButton>
                <ModeButton type="button" $active={interactionMode === "layout"} onClick={() => changeInteractionMode("layout")}>
                  <Move size={16} aria-hidden="true" />
                  <span>Układ</span>
                </ModeButton>
              </ModeSwitcher>
            ) : null}
            <TreeDisplayControls>
              <ModeControl>
                <ModeInput type="checkbox" checked={showBirthSurname} onChange={(event) => setShowBirthSurname(event.target.checked)} />
                <ModeTrack aria-hidden="true" />
                <ModeLabel>Nazwisko rodowe</ModeLabel>
              </ModeControl>
              <TreeExportButton
                type="button"
                onClick={() => void downloadTreePng()}
                disabled={exportingPng || diagramNodes.length === 0}
                aria-label="Pobierz całe drzewo jako PNG"
                title={exportingPng ? "Generowanie PNG" : "Pobierz całe drzewo jako PNG"}
              >
                <Download size={17} aria-hidden="true" />
                <span>{exportingPng ? "..." : "PNG"}</span>
              </TreeExportButton>
            </TreeDisplayControls>
            {exportPngError ? <TreeExportError role="alert">{exportPngError}</TreeExportError> : null}
            {layoutEditMode ? (
              <LayoutTools>
                <LayoutSummary $error={layout.collisionCount > 0}>
                  {layout.collisionCount > 0 ? <AlertTriangle size={15} aria-hidden="true" /> : null}
                  <span>
                    {layout.collisionCount > 0
                      ? `Kolizje: ${layout.collisionCount}`
                      : layoutIsDirty
                        ? `Zmiany: ${layoutDirtyCount}`
                        : `Ustawione: ${layoutPersistedCount}`}
                  </span>
                </LayoutSummary>
                <LayoutActions>
                  <LayoutAction
                    type="button"
                    $primary
                    onClick={() => void saveTreeLayout()}
                    disabled={!layoutIsDirty || layoutSaving || layout.collisionCount > 0}
                    title="Zapisz układ"
                  >
                    <Save size={17} aria-hidden="true" />
                    <span>{layoutSaving ? "Zapisywanie" : "Zapisz"}</span>
                  </LayoutAction>
                  <LayoutIconAction
                    type="button"
                    onClick={edgeSelected ? edgeLayout.undo : layout.undo}
                    disabled={edgeSelected ? !edgeLayout.canUndo : !layout.canUndo}
                    title="Cofnij zmianę"
                    aria-label="Cofnij zmianę"
                  >
                    <Undo2 size={18} aria-hidden="true" />
                  </LayoutIconAction>
                  <LayoutIconAction
                    type="button"
                    onClick={edgeSelected ? edgeLayout.redo : layout.redo}
                    disabled={edgeSelected ? !edgeLayout.canRedo : !layout.canRedo}
                    title="Ponów zmianę"
                    aria-label="Ponów zmianę"
                  >
                    <Redo2 size={18} aria-hidden="true" />
                  </LayoutIconAction>
                  <LayoutIconAction
                    type="button"
                    onClick={edgeSelected ? edgeLayout.resetSelected : layout.resetSelected}
                    disabled={!edgeSelected && !layout.selectedNodeId}
                    title="Przywróć automatyczne położenie zaznaczenia"
                    aria-label="Przywróć automatyczne położenie zaznaczenia"
                  >
                    <PinOff size={18} aria-hidden="true" />
                  </LayoutIconAction>
                  <LayoutIconAction
                    type="button"
                    onClick={resetAllTreeLayout}
                    disabled={!layoutIsDirty && layoutPersistedCount === 0}
                    title="Przywróć cały układ automatyczny"
                    aria-label="Przywróć cały układ automatyczny"
                  >
                    <RotateCcw size={18} aria-hidden="true" />
                  </LayoutIconAction>
                  <LayoutIconAction
                    type="button"
                    onClick={discardTreeLayout}
                    disabled={!layoutIsDirty}
                    title="Odrzuć niezapisane zmiany"
                    aria-label="Odrzuć niezapisane zmiany"
                  >
                    <X size={18} aria-hidden="true" />
                  </LayoutIconAction>
                </LayoutActions>
                {layout.error ? <LayoutError>{layout.error}</LayoutError> : null}
                {edgeLayout.error ? <LayoutError>{edgeLayout.error}</LayoutError> : null}
              </LayoutTools>
            ) : null}
          </ModeControls>
        </Panel>
        <style>{`
          .react-flow__viewport .react-flow__edges {
            z-index: 5 !important;
          }
          .react-flow__viewport .react-flow__nodes {
            z-index: 3 !important;
          }
          .react-flow__viewport .react-flow__nodes:has(.react-flow__node:hover),
          .react-flow__viewport .react-flow__nodes:has(.react-flow__node:focus-within) {
            z-index: 20 !important;
          }
          .react-flow__node:hover,
          .react-flow__node:focus-within {
            z-index: 30 !important;
          }
          .react-flow__edge-path {
            stroke-linecap: square;
            pointer-events: none;
          }
          .genealogy-flow .react-flow__handle {
            pointer-events: none;
          }
          .genealogy-flow.is-editing .react-flow__handle {
            width: 13px !important;
            height: 13px !important;
            opacity: 1 !important;
            pointer-events: auto;
            border: 2px solid #fff !important;
            box-shadow: 0 0 0 1px #5c6b62, 0 2px 5px rgba(28, 42, 34, 0.24);
          }
          .genealogy-flow.is-editing .react-flow__handle[data-handleid="child"],
          .genealogy-flow.is-editing .react-flow__handle[data-handleid="parent"] {
            background: #3d5a4c !important;
          }
          .genealogy-flow.is-editing .react-flow__handle[data-handleid^="partner"] {
            background: #8b5a46 !important;
          }
        `}</style>
      </ReactFlow>

      {draft ? (
        <RelationEditor key={draft.id} draft={draft} people={people} onCancel={() => setDraft(null)} onSave={(target) => saveRelation(draft, target)} />
      ) : null}
      {editingPerson ? (
        <EditPersonEditor
          person={editingPerson}
          people={people}
          relations={relations}
          onCancel={() => setEditingPerson(null)}
          onSave={(values) => savePerson(editingPerson.id, values)}
          onDelete={() => deletePerson(editingPerson)}
          onSaveParentRelation={saveParentRelation}
          onSavePartnerRelation={savePartnerRelation}
          onDeleteRelation={deleteRelation}
        />
      ) : null}
    </Canvas>
  );
}

function DiagramPersonSearch({ nodes }: { nodes: Node[] }) {
  const { getNode, setCenter } = useReactFlow();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const results = useMemo(() => {
    if (!query.trim()) return [];

    const peopleById = new Map<string, { nodeId: string; person: Person }>();
    for (const node of nodes) {
      if (node.type !== "person") continue;
      const person = node.data as unknown as Person;
      if (!person.id) continue;
      const current = peopleById.get(person.id);
      if (!current || node.id === person.id) peopleById.set(person.id, { nodeId: node.id, person });
    }

    return [...peopleById.values()]
      .filter(({ person }) => matchesPersonQuery(person, query))
      .sort(({ person: first }, { person: second }) => personName(first).localeCompare(personName(second), "pl"));
  }, [nodes, query]);

  const totalPages = Math.ceil(results.length / SEARCH_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const visibleResults = results.slice(currentPage * SEARCH_PAGE_SIZE, (currentPage + 1) * SEARCH_PAGE_SIZE);

  const centerPerson = (nodeId: string) => {
    const node = getNode(nodeId);
    if (!node) return;
    const width = node.measured?.width ?? node.width ?? 360;
    const height = node.measured?.height ?? node.height ?? 240;
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { duration: 450, zoom: 1 });
  };

  return (
    <Panel position="top-left">
      <DiagramSearchPanel className="nodrag nopan nowheel">
        <DiagramSearchRow>
          <DiagramSearchInput
            type="search"
            value={query}
            placeholder="Szukaj osoby w drzewie"
            aria-label="Szukaj osoby w drzewie"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && visibleResults[0]) {
                event.preventDefault();
                centerPerson(visibleResults[0].nodeId);
              }
            }}
          />
          {query ? (
            <DiagramClearButton type="button" aria-label="Wyczyść wyszukiwanie" title="Wyczyść" onClick={() => setQuery("")}>
              ×
            </DiagramClearButton>
          ) : null}
        </DiagramSearchRow>

        {query.trim() ? (
          <DiagramResults aria-live="polite">
            <DiagramResultCount>{results.length === 1 ? "1 wynik" : `${results.length} wyników`}</DiagramResultCount>
            {visibleResults.length ? (
              <DiagramResultList>
                {visibleResults.map(({ nodeId, person }) => (
                  <li key={person.id}>
                    <DiagramResultButton type="button" onClick={() => centerPerson(nodeId)}>
                      <DiagramResultName>{personName(person)}</DiagramResultName>
                      <DiagramResultHint>{personDatesOrId(person).text}</DiagramResultHint>
                    </DiagramResultButton>
                  </li>
                ))}
              </DiagramResultList>
            ) : (
              <DiagramSearchEmpty>Brak dopasowanych osób</DiagramSearchEmpty>
            )}

            {totalPages > 1 ? (
              <DiagramPagination aria-label="Strony wyników wyszukiwania">
                <DiagramPageButton
                  type="button"
                  aria-label="Poprzednia strona"
                  title="Poprzednia strona"
                  disabled={currentPage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  ‹
                </DiagramPageButton>
                <DiagramPageStatus>
                  {currentPage + 1} / {totalPages}
                </DiagramPageStatus>
                <DiagramPageButton
                  type="button"
                  aria-label="Następna strona"
                  title="Następna strona"
                  disabled={currentPage === totalPages - 1}
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                >
                  ›
                </DiagramPageButton>
              </DiagramPagination>
            ) : null}
          </DiagramResults>
        ) : null}
      </DiagramSearchPanel>
    </Panel>
  );
}
function EditPersonEditor({
  person,
  people,
  relations,
  onCancel,
  onSave,
  onDelete,
  onSaveParentRelation,
  onSavePartnerRelation,
  onDeleteRelation,
}: {
  person: Person;
  people: Person[];
  relations: Relation[];
  onCancel: () => void;
  onSave: (values: PersonFormValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onSaveParentRelation: (relation: ParentRelation, secondParentId: string, color: string | null, root: boolean) => Promise<void>;
  onSavePartnerRelation: (relation: PartnerRelation, color: string | null, root: boolean) => Promise<void>;
  onDeleteRelation: (relation: Relation) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "relations">("details");
  const [form, setForm] = useState(() => personToForm(person));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
  const [deletingRelationId, setDeletingRelationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peopleById = useMemo(() => new Map(people.map((candidate) => [candidate.id, candidate])), [people]);
  const personRelations = useMemo(
    () =>
      relations.filter(
        (relation) => relation.first.id === person.id || relation.second?.id === person.id || (relation.type === "parent" && relation.person.id === person.id),
      ),
    [person.id, relations],
  );
  const editingRelation = personRelations.find((relation) => relation.id === editingRelationId);
  const busy = saving || deleting || deletingRelationId !== null;

  const personLabelById = (personId: string | null | undefined) => {
    if (!personId) return "Nieznana osoba";
    const candidate = peopleById.get(personId);
    return candidate ? personName(candidate) : personId;
  };

  const describeRelation = (relation: Relation) => {
    if (relation.type === "partner") {
      const otherId = relation.first.id === person.id ? relation.second?.id : relation.first.id;
      return { role: "Partner", description: personLabelById(otherId), parentDetails: null };
    }

    const personIsChild = relation.person.id === person.id;
    const parents = [relation.first.id, relation.second?.id].filter(Boolean).map((personId) => personLabelById(personId));
    const otherParentId = personIsChild ? relation.second?.id : relation.first.id === person.id ? relation.second?.id : relation.first.id;
    const parentshipId = relation.parentship?.id;
    const parentship = parentshipId ? relations.find((candidate) => candidate.type === "partner" && candidate.id === parentshipId) : null;
    const parentshipPeople = parentship ? [parentship.first.id, parentship.second?.id].filter(Boolean).map((personId) => personLabelById(personId)) : [];

    return {
      role: personIsChild ? "Dziecko" : "Rodzic",
      description: personIsChild ? `Rodzice: ${parents.join(" i ") || "brak danych"}` : `Dziecko: ${personLabelById(relation.person.id)}`,
      parentDetails: {
        hasSecondParent: Boolean(relation.second?.id),
        secondParentText: `${personIsChild ? "Drugi rodzic" : "Drugi rodzic dziecka"}: ${otherParentId ? personLabelById(otherParentId) : "nieznany"}`,
        hasParentship: Boolean(parentshipId),
        parentshipText: parentshipId
          ? parentship
            ? `Para z parentship: ${parentshipPeople.join(" i ")}`
            : `parentship: ${parentshipId} (brak relacji pary)`
          : "Bez parentship - bezpośrednia relacja rodzic–dziecko",
      },
    };
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeTab !== "details") return;
    setError(null);

    const validationError = validatePersonForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać osoby.");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await onDelete();
      setDeleting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się usunąć osoby.");
      setDeleting(false);
    }
  };

  const handleDeleteRelation = async (relation: Relation) => {
    const impact = getRelationDeletionImpact(relation, relations);
    const description = describeRelation(relation);
    const dependentSummary = impact.parentshipsToClear > 0 ? `\nPowiązania dzieci z parą do wyczyszczenia: ${impact.parentshipsToClear}.` : "";
    const rootWarning = impact.deletesRootRelation
      ? "\n\nUwaga: to relacja root. Jej usunięcie może ukryć całe drzewo do czasu wskazania nowej relacji root."
      : "";
    if (!window.confirm(`Usunąć relację „${description.role}: ${description.description}”?${dependentSummary}${rootWarning}\n\nTej operacji nie można cofnąć.`))
      return;

    setError(null);
    setDeletingRelationId(relation.id);
    try {
      await onDeleteRelation(relation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się usunąć relacji.");
    } finally {
      setDeletingRelationId(null);
    }
  };

  return (
    <EditorDrawer className="nodrag nopan nowheel" onSubmit={handleSubmit}>
      <EditorHeader>
        <div>
          <EditorTitle>Edytuj osobę</EditorTitle>
          <EditorContext>{personName(person)}</EditorContext>
        </div>
        <CloseButton type="button" onClick={onCancel} disabled={busy} aria-label="Zamknij formularz" title="Zamknij">
          ×
        </CloseButton>
      </EditorHeader>

      <EditorTabs role="tablist" aria-label="Edycja osoby">
        <EditorTabButton
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          aria-controls="person-details-panel"
          $active={activeTab === "details"}
          disabled={busy}
          onClick={() => {
            setActiveTab("details");
            setEditingRelationId(null);
            setError(null);
          }}
        >
          Dane osoby
        </EditorTabButton>
        <EditorTabButton
          type="button"
          role="tab"
          aria-selected={activeTab === "relations"}
          aria-controls="person-relations-panel"
          $active={activeTab === "relations"}
          disabled={busy}
          onClick={() => {
            setActiveTab("relations");
            setEditingRelationId(null);
            setError(null);
          }}
        >
          Relacje ({personRelations.length})
        </EditorTabButton>
      </EditorTabs>

      {activeTab === "details" ? (
        <div id="person-details-panel" role="tabpanel">
          <PersonFormFields value={form} onChange={setForm} idPrefix="edit-person" autoFocus />
          {error ? <EditorError>{error}</EditorError> : null}
          <EditorActions>
            <SaveButton type="submit" disabled={busy}>
              {saving ? "Zapisywanie…" : "Zapisz zmiany"}
            </SaveButton>
            <CancelButton type="button" onClick={onCancel} disabled={busy}>
              Anuluj
            </CancelButton>
            <DeletePersonButton type="button" onClick={() => void handleDelete()} disabled={busy}>
              {deleting ? "Usuwanie…" : "Usuń osobę"}
            </DeletePersonButton>
          </EditorActions>
        </div>
      ) : (
        <PersonRelationsPanel id="person-relations-panel" role="tabpanel">
          {editingRelation?.type === "parent" ? (
            <ParentRelationEditor
              relation={editingRelation}
              people={people}
              relations={relations}
              onCancel={() => setEditingRelationId(null)}
              onSave={async (secondParentId, color, root) => {
                await onSaveParentRelation(editingRelation, secondParentId, color, root);
                setEditingRelationId(null);
              }}
            />
          ) : editingRelation?.type === "partner" ? (
            <PartnerRelationEditor
              relation={editingRelation}
              people={people}
              onCancel={() => setEditingRelationId(null)}
              onSave={async (color, root) => {
                await onSavePartnerRelation(editingRelation, color, root);
                setEditingRelationId(null);
              }}
            />
          ) : personRelations.length === 0 ? (
            <RelationsEmpty>Ta osoba nie ma zapisanych relacji.</RelationsEmpty>
          ) : (
            <PersonRelationsList>
              {personRelations.map((relation) => {
                const description = describeRelation(relation);
                return (
                  <PersonRelationItem key={relation.id}>
                    <PersonRelationContent>
                      <PersonRelationHeading>
                        <RelationRole $type={relation.type}>{description.role}</RelationRole>
                        {relation.color ? (
                          <RelationColorBadge>
                            <RelationColorBadgeSwatch $color={relation.color} />
                            {relation.color}
                          </RelationColorBadge>
                        ) : null}
                        {relation.root ? <RelationRootBadge>root</RelationRootBadge> : null}
                      </PersonRelationHeading>
                      <PersonRelationDescription>{description.description}</PersonRelationDescription>
                      {description.parentDetails ? (
                        <ParentRelationDetails>
                          <ParentRelationStatuses>
                            <ParentRelationStatus $tone={description.parentDetails.hasSecondParent ? "positive" : "warning"}>
                              {description.parentDetails.hasSecondParent ? "Dwoje rodziców" : "Jeden znany rodzic"}
                            </ParentRelationStatus>
                            <ParentRelationStatus $tone={description.parentDetails.hasParentship ? "linked" : "direct"}>
                              {description.parentDetails.hasParentship ? "Z parentship" : "Bez parentship"}
                            </ParentRelationStatus>
                          </ParentRelationStatuses>
                          <ParentRelationDetail>{description.parentDetails.secondParentText}</ParentRelationDetail>
                          <ParentRelationDetail>{description.parentDetails.parentshipText}</ParentRelationDetail>
                        </ParentRelationDetails>
                      ) : null}
                      <PersonRelationId>{relation.id}</PersonRelationId>
                    </PersonRelationContent>
                    <RelationItemActions>
                      <RelationEditButton type="button" disabled={busy} onClick={() => setEditingRelationId(relation.id)}>
                        Edytuj
                      </RelationEditButton>
                      <RelationDeleteButton
                        type="button"
                        disabled={busy}
                        aria-label={`Usuń relację ${description.role}: ${description.description}`}
                        onClick={() => void handleDeleteRelation(relation)}
                      >
                        {deletingRelationId === relation.id ? "Usuwanie…" : "Usuń"}
                      </RelationDeleteButton>
                    </RelationItemActions>
                  </PersonRelationItem>
                );
              })}
            </PersonRelationsList>
          )}
          {error ? <EditorError>{error}</EditorError> : null}
        </PersonRelationsPanel>
      )}
    </EditorDrawer>
  );
}
function ParentRelationEditor({
  relation,
  people,
  relations,
  onCancel,
  onSave,
}: {
  relation: ParentRelation;
  people: Person[];
  relations: Relation[];
  onCancel: () => void;
  onSave: (secondParentId: string, color: string | null, root: boolean) => Promise<void>;
}) {
  const [secondParentId, setSecondParentId] = useState(relation.second?.id ?? "");
  const [color, setColor] = useState(relation.color ?? "");
  const [root, setRoot] = useState(relation.root);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const availablePeople = useMemo(
    () => people.filter((person) => person.id !== relation.first.id && person.id !== relation.person.id),
    [people, relation.first.id, relation.person.id],
  );
  const matchedParentship = useMemo(() => {
    if (!secondParentId) return null;
    return (
      relations
        .filter(
          (candidate): candidate is PartnerRelation =>
            candidate.type === "partner" &&
            ((candidate.first.id === relation.first.id && candidate.second?.id === secondParentId) ||
              (candidate.first.id === secondParentId && candidate.second?.id === relation.first.id)),
        )
        .sort((first, second) => first.id.localeCompare(second.id))[0] ?? null
    );
  }, [relation.first.id, relations, secondParentId]);

  const labelById = (personId: string) => {
    const person = peopleById.get(personId);
    return person ? personName(person) : personId;
  };
  const rootAvailable = !secondParentId;
  const effectiveRoot = rootAvailable ? root : false;
  const parentshipPeople = matchedParentship
    ? [matchedParentship.first.id, matchedParentship.second?.id]
        .filter((personId): personId is string => Boolean(personId))
        .map((personId) => labelById(personId))
    : [];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(secondParentId, color || null, effectiveRoot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zaktualizować relacji.");
      setSaving(false);
    }
  };

  return (
    <ParentRelationEditPanel>
      <ParentRelationEditHeader>
        <div>
          <ParentRelationEditTitle>Edytuj relację rodzic–dziecko</ParentRelationEditTitle>
          <PersonRelationId>{relation.id}</PersonRelationId>
        </div>
        <CloseButton type="button" onClick={onCancel} disabled={saving} aria-label="Zamknij edycję relacji" title="Zamknij">
          ×
        </CloseButton>
      </ParentRelationEditHeader>

      <ParentRelationFixedData>
        <ParentRelationFixedItem>
          <span>Pierwszy rodzic</span>
          <strong>{labelById(relation.first.id)}</strong>
        </ParentRelationFixedItem>
        <ParentRelationFixedItem>
          <span>Dziecko</span>
          <strong>{labelById(relation.person.id)}</strong>
        </ParentRelationFixedItem>
      </ParentRelationFixedData>

      <EditorField>
        <EditorLabel htmlFor={`edit-second-parent-${relation.id}`}>Drugi rodzic</EditorLabel>
        <PersonSearchSelect
          id={`edit-second-parent-${relation.id}`}
          people={availablePeople}
          value={secondParentId}
          onChange={setSecondParentId}
          allowEmpty
          emptyLabel="Brak drugiego rodzica"
          placeholder="Wyszukaj drugiego rodzica"
        />
      </EditorField>

      <RelationColorField id={`parent-relation-color-${relation.id}`} value={color} onChange={setColor} disabled={saving} />

      <RelationRootField
        id={`parent-relation-root-${relation.id}`}
        checked={effectiveRoot}
        currentRoot={relation.root}
        available={rootAvailable}
        disabled={saving}
        onChange={setRoot}
      />

      <ParentshipMatch $matched={Boolean(matchedParentship)} $empty={!secondParentId}>
        <strong>Parentship</strong>
        <span>
          {!secondParentId
            ? "Brak drugiego rodzica. Parentship zostanie wyczyszczone."
            : matchedParentship
              ? `Dopasowano parę: ${parentshipPeople.join(" i ")} (${matchedParentship.id}).`
              : "Brak relacji partnerskiej dla wybranych rodziców. Parentship zostanie wyczyszczone."}
        </span>
      </ParentshipMatch>

      {error ? <EditorError>{error}</EditorError> : null}
      <EditorActions>
        <SaveButton type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Zapisywanie…" : "Zapisz relację"}
        </SaveButton>
        <CancelButton type="button" disabled={saving} onClick={onCancel}>
          Anuluj
        </CancelButton>
      </EditorActions>
    </ParentRelationEditPanel>
  );
}

function PartnerRelationEditor({
  relation,
  people,
  onCancel,
  onSave,
}: {
  relation: PartnerRelation;
  people: Person[];
  onCancel: () => void;
  onSave: (color: string | null, root: boolean) => Promise<void>;
}) {
  const [color, setColor] = useState(relation.color ?? "");
  const [root, setRoot] = useState(relation.root);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const labelById = (personId: string | null | undefined) => {
    if (!personId) return "Nieznana osoba";
    const person = peopleById.get(personId);
    return person ? personName(person) : personId;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(color || null, root);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zaktualizować relacji.");
      setSaving(false);
    }
  };

  return (
    <ParentRelationEditPanel>
      <ParentRelationEditHeader>
        <div>
          <ParentRelationEditTitle>Edytuj relację partnerską</ParentRelationEditTitle>
          <PersonRelationId>{relation.id}</PersonRelationId>
        </div>
        <CloseButton type="button" onClick={onCancel} disabled={saving} aria-label="Zamknij edycję relacji" title="Zamknij">
          ×
        </CloseButton>
      </ParentRelationEditHeader>

      <ParentRelationFixedData>
        <ParentRelationFixedItem>
          <span>Pierwsza osoba</span>
          <strong>{labelById(relation.first.id)}</strong>
        </ParentRelationFixedItem>
        <ParentRelationFixedItem>
          <span>Druga osoba</span>
          <strong>{labelById(relation.second?.id)}</strong>
        </ParentRelationFixedItem>
      </ParentRelationFixedData>

      <RelationColorField id={`partner-relation-color-${relation.id}`} value={color} onChange={setColor} disabled={saving} />

      <RelationRootField
        id={`partner-relation-root-${relation.id}`}
        checked={root}
        currentRoot={relation.root}
        available
        disabled={saving}
        onChange={setRoot}
      />

      {error ? <EditorError>{error}</EditorError> : null}
      <EditorActions>
        <SaveButton type="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Zapisywanie…" : "Zapisz relację"}
        </SaveButton>
        <CancelButton type="button" disabled={saving} onClick={onCancel}>
          Anuluj
        </CancelButton>
      </EditorActions>
    </ParentRelationEditPanel>
  );
}

function RelationRootField({
  id,
  checked,
  currentRoot,
  available,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  currentRoot: boolean;
  available: boolean;
  disabled: boolean;
  onChange: (root: boolean) => void;
}) {
  const locked = currentRoot && checked;
  const hint = !available
    ? "Relacja parent z drugim rodzicem lub parentship nie może być punktem startowym."
    : locked
      ? "To jest obecny root. Aby go przenieść, ustaw root na innej relacji."
      : checked
        ? "Po zapisie ta relacja zostanie rootem, a poprzedni root zostanie wyłączony."
        : "Root określa punkt startowy wyświetlania drzewa.";

  return (
    <EditorField>
      <EditorLabel>Root drzewa</EditorLabel>
      <RelationRootControl>
        <RelationRootToggle htmlFor={id}>
          <input id={id} type="checkbox" checked={checked} disabled={disabled || !available || locked} onChange={(event) => onChange(event.target.checked)} />
          Punkt startowy drzewa
        </RelationRootToggle>
        {checked ? <RelationRootStatus>root</RelationRootStatus> : null}
      </RelationRootControl>
      <RelationColorHint>{hint}</RelationColorHint>
    </EditorField>
  );
}

function RelationColorField({ id, value, onChange, disabled = false }: { id: string; value: string; onChange: (color: string) => void; disabled?: boolean }) {
  const enabled = Boolean(value);

  return (
    <EditorField>
      <EditorLabel>Kolor gałęzi</EditorLabel>
      <RelationColorControl>
        <RelationColorToggle htmlFor={`${id}-enabled`}>
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? DEFAULT_RELATION_COLOR : "")}
          />
          Własny kolor relacji i jej potomków
        </RelationColorToggle>
        {enabled ? (
          <RelationColorInput
            id={id}
            type="color"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Kolor relacji"
          />
        ) : null}
      </RelationColorControl>
      <RelationColorHint>Kolor działa w dół drzewa. Bliższa relacja z własnym kolorem nadpisze ten motyw.</RelationColorHint>
    </EditorField>
  );
}

function RelationEditor({
  draft,
  people,
  onCancel,
  onSave,
}: {
  draft: RelationDraft;
  people: Person[];
  onCancel: () => void;
  onSave: (target: RelationTarget) => Promise<void>;
}) {
  const excludedIds = useMemo(() => new Set(draft.kind === "partner" ? [draft.sourcePersonId] : [draft.firstId, draft.secondId].filter(Boolean)), [draft]);
  const availablePeople = useMemo(() => people.filter((person) => !excludedIds.has(person.id)), [excludedIds, people]);
  const validPreselection = draft.preselectedPersonId && !excludedIds.has(draft.preselectedPersonId) ? draft.preselectedPersonId : "";
  const [mode, setMode] = useState<"existing" | "new">(validPreselection ? "existing" : "new");
  const [personId, setPersonId] = useState(validPreselection);
  const [person, setPerson] = useState<PersonFormValues>(emptyPersonForm);
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    draft.kind === "partner"
      ? draft.sourceRole === "first"
        ? "Dodaj partnera po prawej"
        : "Dodaj partnera po lewej"
      : draft.parentshipId
        ? "Dodaj dziecko pary"
        : "Dodaj dziecko";
  const sourceLabel = draft.kind === "partner" ? draft.sourcePersonName : draft.sourceLabel;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (mode === "existing" && !personId) {
      setError("Wybierz osobę.");
      return;
    }
    if (mode === "new") {
      const validationError = validatePersonForm(person);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSaving(true);
    try {
      await onSave(mode === "existing" ? { mode, personId, color: color || null } : { mode, person, color: color || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać relacji.");
      setSaving(false);
    }
  };

  return (
    <EditorDrawer className="nodrag nopan nowheel" onSubmit={handleSubmit}>
      <EditorHeader>
        <div>
          <EditorTitle>{title}</EditorTitle>
          <EditorContext>{sourceLabel}</EditorContext>
        </div>
        <CloseButton type="button" onClick={onCancel} aria-label="Zamknij formularz" title="Zamknij">
          ×
        </CloseButton>
      </EditorHeader>

      <RelationSummary>
        <span>Relacja</span>
        <strong>{draft.kind === "partner" ? "partner" : "parent"}</strong>
      </RelationSummary>

      <RelationColorField id="new-relation-color" value={color} onChange={setColor} disabled={saving} />

      <Segmented aria-label="Źródło osoby">
        <SegmentButton type="button" $active={mode === "existing"} onClick={() => setMode("existing")}>
          Istniejąca osoba
        </SegmentButton>
        <SegmentButton type="button" $active={mode === "new"} onClick={() => setMode("new")}>
          Nowa osoba
        </SegmentButton>
      </Segmented>

      {mode === "existing" ? (
        <EditorField>
          <EditorLabel htmlFor="relation-person">Osoba *</EditorLabel>
          <PersonSearchSelect id="relation-person" people={availablePeople} value={personId} onChange={setPersonId} required placeholder="Szukaj osoby…" />
        </EditorField>
      ) : (
        <PersonFormFields value={person} onChange={setPerson} idPrefix="new-person" autoFocus />
      )}
      {error ? <EditorError>{error}</EditorError> : null}
      <EditorActions>
        <SaveButton type="submit" disabled={saving}>
          {saving ? "Zapisywanie…" : draft.kind === "partner" ? "Dodaj relację" : "Dodaj dziecko"}
        </SaveButton>
        <CancelButton type="button" onClick={onCancel} disabled={saving}>
          Anuluj
        </CancelButton>
      </EditorActions>
    </EditorDrawer>
  );
}

const Canvas = styled.div`
  position: relative;
  width: 100vw;
  height: calc(100vh - 4rem);
  background: #f3efe8;

  .genealogy-flow.is-exporting .react-flow__node button {
    display: none !important;
  }

  .genealogy-flow.is-exporting [data-layout-selected="true"] {
    outline: none !important;
  }
`;

const DiagramSearchPanel = styled.section`
  --ink: #1c2a22;
  --muted: #5c6b62;
  --line: #c5b8a4;
  --accent: #3d5a4c;

  width: min(22rem, calc(100vw - 2rem));
  margin-top: 0;
  border: 1px solid var(--line);
  background: #f7f4ef;
  color: var(--ink);
  box-shadow: 0 5px 18px rgba(28, 42, 34, 0.14);
`;

const DiagramSearchRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const DiagramSearchInput = styled.input`
  box-sizing: border-box;
  width: 100%;
  border: none;
  background: #fff;
  color: var(--ink);
  padding: 0.75rem 2.5rem 0.75rem 0.85rem;
  font: inherit;
  font-size: 1rem;
  outline: none;

  &:focus {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
`;

const DiagramClearButton = styled.button`
  position: absolute;
  right: 0.45rem;
  width: 2rem;
  height: 2rem;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--ink);
  }
`;

const DiagramResults = styled.div`
  border-top: 1px solid var(--line);
`;

const DiagramResultCount = styled.div`
  padding: 0.5rem 0.75rem;
  color: var(--muted);
  font-size: 0.76rem;
`;

const DiagramResultList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

const DiagramResultButton = styled.button`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 2.8rem;
  border: none;
  border-top: 1px solid #ded6ca;
  background: #fff;
  color: var(--ink);
  padding: 0.55rem 0.75rem;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: #e8efe9;
    outline: none;
  }
`;

const DiagramResultName = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DiagramResultHint = styled.span`
  flex: none;
  color: var(--muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
`;

const DiagramSearchEmpty = styled.div`
  border-top: 1px solid #ded6ca;
  padding: 0.75rem;
  color: var(--muted);
  font-size: 0.85rem;
`;

const DiagramPagination = styled.nav`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  border-top: 1px solid var(--line);
  padding: 0.5rem;
`;

const DiagramPageButton = styled.button`
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: var(--accent);
    outline: none;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const DiagramPageStatus = styled.span`
  min-width: 3.5rem;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;
const ModeInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
`;

const ModeTrack = styled.span`
  position: relative;
  width: 2.5rem;
  height: 1.35rem;
  flex: none;
  border: 1px solid #8a735a;
  border-radius: 999px;
  background: #d8d0c3;
  transition: background 0.15s ease;

  &::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(28, 42, 34, 0.25);
    transition: transform 0.15s ease;
  }
`;

const AutomaticLayoutPanel = styled.section`
  box-sizing: border-box;
  width: min(20rem, calc(100vw - 2rem));
  max-height: calc(100vh - 7rem);
  overflow: auto;
  border: 1px solid #b9aa94;
  background: #f7f4ef;
  padding: 0.85rem;
  box-shadow: 0 4px 16px rgba(28, 42, 34, 0.14);
`;

const AutomaticLayoutHeader = styled.h2`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.85rem;
  color: #1c2a22;
  font-size: 0.95rem;
  line-height: 1.2;
  font-weight: 700;
`;

const AutomaticLayoutField = styled.div`
  display: grid;
  gap: 0.35rem;
  margin-top: 0.65rem;
`;

const AutomaticLayoutLabel = styled.label`
  color: #5c6b62;
  font-size: 0.74rem;
  line-height: 1.2;
  font-weight: 700;
`;

const AutomaticLayoutMovementControl = styled.label`
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.25rem;
  cursor: pointer;
  user-select: none;

  ${ModeInput}:checked + ${ModeTrack} {
    background: #3d5a4c;
  }

  ${ModeInput}:checked + ${ModeTrack}::after {
    transform: translateX(1.1rem);
  }

  ${ModeInput}:focus-visible + ${ModeTrack} {
    outline: 2px solid #3d5a4c;
    outline-offset: 2px;
  }
`;

const AutomaticLayoutMovementValue = styled.span`
  color: #1c2a22;
  font-size: 0.8rem;
  font-weight: 650;
`;

const AutomaticLayoutSelect = styled.select`
  box-sizing: border-box;
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid #c5b8a4;
  border-radius: 4px;
  background: #fff;
  color: #1c2a22;
  padding: 0.5rem 2rem 0.5rem 0.6rem;
  font: inherit;
  font-size: 0.8rem;

  &:focus-visible {
    border-color: #3d5a4c;
    outline: 2px solid rgba(61, 90, 76, 0.2);
    outline-offset: 1px;
  }

  &:disabled {
    background: #ece7df;
    color: #7c837e;
    cursor: default;
  }
`;

const AutomaticLayoutDivider = styled.div`
  height: 1px;
  margin: 0.9rem 0 0.15rem;
  background: #d8d0c3;
`;

const AutomaticLayoutStatus = styled.p`
  margin: 0.65rem 0 0;
  color: #5c6b62;
  font-size: 0.74rem;
`;

const AutomaticLayoutError = styled(AutomaticLayoutStatus)`
  color: #a33b32;
  line-height: 1.35;
`;
const TreeDisplayControls = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0.45rem;
  max-width: calc(100vw - 2rem);
`;

const TreeExportButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 4.6rem;
  min-height: 2.65rem;
  border: 1px solid #3d5a4c;
  background: #3d5a4c;
  color: #fff;
  padding: 0 0.7rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    background: #334d41;
    outline: 2px solid rgba(61, 90, 76, 0.22);
    outline-offset: 2px;
  }

  &:disabled {
    border-color: #9ba59f;
    background: #9ba59f;
    cursor: wait;
  }
`;

const TreeExportError = styled.p`
  width: min(22rem, calc(100vw - 2rem));
  margin: 0;
  color: #a33b32;
  font-size: 0.74rem;
  line-height: 1.35;
`;

const ModeControls = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.45rem;
`;
const ModeControl = styled.label`
  --ink: #1c2a22;

  position: relative;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid #c5b8a4;
  background: #f7f4ef;
  box-shadow: 0 3px 12px rgba(28, 42, 34, 0.12);
  cursor: pointer;
  user-select: none;

  ${ModeInput}:checked + ${ModeTrack} {
    background: #3d5a4c;
  }

  ${ModeInput}:checked + ${ModeTrack}::after {
    transform: translateX(1.1rem);
  }

  ${ModeInput}:focus-visible + ${ModeTrack} {
    outline: 2px solid #3d5a4c;
    outline-offset: 2px;
  }
`;

const ModeLabel = styled.span`
  color: var(--ink);
  font-size: 0.82rem;
  font-weight: 500;
`;

const ModeSwitcher = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(22rem, calc(100vw - 2rem));
  border: 1px solid #c5b8a4;
  background: #f7f4ef;
  box-shadow: 0 3px 12px rgba(28, 42, 34, 0.12);
`;

const ModeButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-width: 0;
  min-height: 2.65rem;
  border: none;
  border-right: 1px solid #d8d0c3;
  background: ${({ $active }) => ($active ? "#3d5a4c" : "#f7f4ef")};
  color: ${({ $active }) => ($active ? "#fff" : "#1c2a22")};
  padding: 0.55rem 0.65rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;

  &:last-child {
    border-right: none;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    background: ${({ $active }) => ($active ? "#334d41" : "#e8efe9")};
    outline: none;
  }
`;

const LayoutTools = styled.div`
  box-sizing: border-box;
  width: min(22rem, calc(100vw - 2rem));
  border: 1px solid #c5b8a4;
  background: #f7f4ef;
  padding: 0.65rem;
  box-shadow: 0 3px 12px rgba(28, 42, 34, 0.12);
`;

const LayoutSummary = styled.div<{ $error: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.25rem;
  margin-bottom: 0.55rem;
  color: ${({ $error }) => ($error ? "#a33b32" : "#5c6b62")};
  font-size: 0.78rem;
  font-weight: 650;
`;

const LayoutActions = styled.div`
  display: grid;
  grid-template-columns: minmax(6rem, 1fr) repeat(5, 2.55rem);
  gap: 0.35rem;

  @media (max-width: 430px) {
    grid-template-columns: minmax(5.5rem, 1fr) repeat(5, 2.35rem);
  }
`;

const LayoutAction = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 0;
  height: 2.55rem;
  border: 1px solid ${({ $primary }) => ($primary ? "#3d5a4c" : "#c5b8a4")};
  background: ${({ $primary }) => ($primary ? "#3d5a4c" : "#fff")};
  color: ${({ $primary }) => ($primary ? "#fff" : "#1c2a22")};
  padding: 0 0.6rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: #3d5a4c;
    outline: none;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const LayoutIconAction = styled(LayoutAction)`
  width: 2.55rem;
  padding: 0;

  @media (max-width: 430px) {
    width: 2.35rem;
  }
`;

const LayoutError = styled.p`
  margin: 0.55rem 0 0;
  color: #a33b32;
  font-size: 0.75rem;
  line-height: 1.35;
`;

const EditorDrawer = styled.form`
  --ink: #1c2a22;
  --muted: #5c6b62;
  --paper: #f7f4ef;
  --line: #c5b8a4;
  --accent: #3d5a4c;

  position: absolute;
  z-index: 30;
  top: 1.75rem;
  right: 1rem;
  width: min(30rem, calc(100vw - 2rem));
  max-height: calc(100vh - 3.75rem);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-top: 3px solid var(--accent);
  background: var(--paper);
  color: var(--ink);
  padding: 1rem;
  box-shadow: 0 12px 32px rgba(28, 42, 34, 0.18);
`;

const EditorHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
`;

const EditorTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--line);
`;

const EditorTabButton = styled.button<{ $active: boolean }>`
  border: none;
  border-bottom: 3px solid ${({ $active }) => ($active ? "var(--accent)" : "transparent")};
  background: ${({ $active }) => ($active ? "#e8efe9" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--ink)" : "var(--muted)")};
  padding: 0.65rem 0.5rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #eee8de;
    color: var(--ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const PersonRelationsPanel = styled.div`
  min-width: 0;
`;

const PersonRelationsList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const PersonRelationItem = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--line);
  background: #fff;
  padding: 0.7rem 0.75rem;
`;

const PersonRelationContent = styled.div`
  min-width: 0;
`;

const PersonRelationHeading = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

const RelationRole = styled.span<{ $type: Relation["type"] }>`
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  border: 1px solid ${({ $type }) => ($type === "partner" ? "#91aa9b" : "#c5b8a4")};
  background: ${({ $type }) => ($type === "partner" ? "#e8efe9" : "#efe8dc")};
  color: var(--ink);
  padding: 0.1rem 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
`;

const RelationColorBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
`;

const RelationColorBadgeSwatch = styled.span<{ $color: string }>`
  width: 0.72rem;
  height: 0.72rem;
  border: 1px solid var(--line);
  background: ${({ $color }) => $color};
`;

const RelationRootBadge = styled.span`
  color: #8b3a2a;
  font-size: 0.7rem;
  font-weight: 700;
`;

const PersonRelationDescription = styled.p`
  margin: 0.35rem 0 0;
  color: var(--ink);
  font-size: 0.84rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const ParentRelationDetails = styled.div`
  margin-top: 0.55rem;
  border-top: 1px solid #ded6ca;
  padding-top: 0.5rem;
`;

const ParentRelationStatuses = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const ParentRelationStatus = styled.span<{ $tone: "positive" | "warning" | "linked" | "direct" }>`
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  border: 1px solid
    ${({ $tone }) => ({ positive: "#91aa9b", warning: "#c88978", linked: "#93a6b0", direct: "#b9ad9b" })[$tone]};
  background: ${({ $tone }) => ({ positive: "#e8efe9", warning: "#fff1ee", linked: "#e9eef2", direct: "#f1ede7" })[$tone]};
  color: ${({ $tone }) => ($tone === "warning" ? "#8b3a2a" : "var(--ink)")};
  padding: 0.1rem 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
`;

const ParentRelationDetail = styled.p`
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const PersonRelationId = styled.p`
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
`;

const RelationItemActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const RelationEditButton = styled.button`
  border: 1px solid var(--accent);
  background: #fff;
  color: var(--accent);
  padding: 0.45rem 0.65rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const ParentRelationEditPanel = styled.section`
  border-top: 3px solid var(--accent);
  background: #fff;
  padding: 0.85rem;
`;

const ParentRelationEditHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
`;

const ParentRelationEditTitle = styled.h3`
  margin: 0;
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 700;
`;

const ParentRelationFixedData = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
  margin-bottom: 0.8rem;

  @media (max-width: 420px) {
    grid-template-columns: 1fr;
  }
`;

const ParentRelationFixedItem = styled.div`
  min-width: 0;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.45rem;

  span,
  strong {
    display: block;
  }

  span {
    color: var(--muted);
    font-size: 0.68rem;
  }

  strong {
    margin-top: 0.2rem;
    color: var(--ink);
    font-size: 0.8rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
`;

const ParentshipMatch = styled.div<{ $matched: boolean; $empty: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.75rem;
  border: 1px solid ${({ $matched, $empty }) => ($matched ? "#91aa9b" : $empty ? "#b9ad9b" : "#c88978")};
  background: ${({ $matched, $empty }) => ($matched ? "#e8efe9" : $empty ? "#f1ede7" : "#fff1ee")};
  color: ${({ $matched, $empty }) => ($matched || $empty ? "var(--ink)" : "#8b3a2a")};
  padding: 0.6rem 0.65rem;
  font-size: 0.72rem;
  line-height: 1.4;

  strong {
    font-size: 0.7rem;
  }
`;

const RelationDeleteButton = styled.button`
  border: 1px solid #b84332;
  background: #fff;
  color: #9f3023;
  padding: 0.45rem 0.65rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #9f3023;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #9f3023;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const RelationsEmpty = styled.p`
  margin: 0;
  border: 1px dashed var(--line);
  color: var(--muted);
  padding: 1rem;
  font-size: 0.82rem;
  text-align: center;
`;

const EditorTitle = styled.h2`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
`;

const EditorContext = styled.p`
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.78rem;
`;

const CloseButton = styled.button`
  width: 2rem;
  height: 2rem;
  flex: none;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
  font: inherit;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--ink);
    border-color: var(--accent);
  }
`;

const RelationSummary = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
  padding: 0.55rem 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.78rem;

  strong {
    color: var(--ink);
    font-weight: 600;
  }
`;

const Segmented = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 0.9rem;
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  border: 1px solid var(--line);
  background: ${({ $active }) => ($active ? "var(--accent)" : "#fff")};
  color: ${({ $active }) => ($active ? "#fff" : "var(--ink)")};
  padding: 0.5rem 0.4rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;

  & + & {
    border-left: none;
  }
`;

const EditorField = styled.div<{ $span?: boolean }>`
  grid-column: ${({ $span }) => ($span ? "1 / -1" : "auto")};
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
`;

const EditorLabel = styled.label`
  color: var(--muted);
  font-size: 0.75rem;
`;

const RelationRootControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.5rem;
  border: 1px solid var(--line);
  background: #fff;
  padding: 0.45rem 0.6rem;
`;

const RelationRootToggle = styled.label`
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink);
  font-size: 0.78rem;
  line-height: 1.3;

  input {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    accent-color: var(--accent);
  }
`;

const RelationRootStatus = styled.strong`
  border-left: 2px solid #8b3a2a;
  color: #8b3a2a;
  padding-left: 0.45rem;
  font-size: 0.7rem;
  text-transform: uppercase;
`;

const RelationColorControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.5rem;
  border: 1px solid var(--line);
  background: #fff;
  padding: 0.45rem 0.6rem;
`;

const RelationColorToggle = styled.label`
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink);
  font-size: 0.78rem;
  line-height: 1.3;

  input {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    accent-color: var(--accent);
  }
`;

const RelationColorInput = styled.input`
  width: 3rem;
  height: 2rem;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  background: #fff;
  padding: 0.12rem;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const RelationColorHint = styled.span`
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.35;
`;

const EditorError = styled.p`
  margin: 0.75rem 0 0;
  color: #8b3a2a;
  font-size: 0.8rem;
`;

const EditorActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-top: 1rem;
`;

const SaveButton = styled.button`
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const CancelButton = styled.button`
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;
const DeletePersonButton = styled.button`
  margin-left: auto;
  border: 1px solid #b84332;
  background: #fff;
  color: #9f3023;
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #fff1ee;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;
