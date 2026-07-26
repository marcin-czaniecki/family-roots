import { Background, type Edge, type Node, type OnConnectEnd, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import styled from "styled-components";
import { FitToTop } from "@/components/FitToTop";
import { PersonFormFields } from "@/components/PersonFormFields";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { matchesPersonQuery, personDatesOrId, personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";
import type { PartnerRelation, Relation } from "@/entities/relation/types";
import { edgeTypes, nodeTypes } from "@/features/genealogyLayout";
import { deletePersonWithRelations, getPersonDeletionImpact } from "@/features/personDeletion";
import { emptyPersonForm, type PersonFormValues, personFormPayload, personToForm, validatePersonForm } from "@/features/personForm";
import { useGenealogyRealtime } from "@/features/useGenealogyRealtime";
import { db } from "@/firebase";

import "@xyflow/react/dist/style.css";

type GenealogyLoaderData = {
  nodes: Node[];
  edges: Edge[];
  people: Person[];
  relations: Relation[];
};

const SEARCH_PAGE_SIZE = 6;

type RelationTarget = { mode: "existing"; personId: string } | { mode: "new"; person: PersonFormValues };

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
  const { nodes: loadedNodes, edges: loadedEdges, people: loadedPeople, relations: loadedRelations } = useLoaderData<GenealogyLoaderData>();
  const { graph, people, relations } = useGenealogyRealtime({ people: loadedPeople, relations: loadedRelations }, { nodes: loadedNodes, edges: loadedEdges });
  const [editMode, setEditMode] = useState(false);
  const [showBirthSurname, setShowBirthSurname] = useState(false);
  const [draft, setDraft] = useState<RelationDraft | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const openPersonEditor = useCallback((person: Person) => {
    setDraft(null);
    setEditingPerson(person);
  }, []);
  const diagramNodes = useMemo(
    () =>
      graph.nodes.map((node) =>
        node.type === "person"
          ? {
              ...node,
              data: { ...node.data, editMode, onEdit: openPersonEditor, showBirthSurname },
            }
          : node,
      ),
    [editMode, graph.nodes, openPersonEditor, showBirthSurname],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      if (!editMode || !connectionState.fromNode || !connectionState.fromHandle || connectionState.fromHandle.type !== "source") return;

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
    [editMode, peopleById, relations],
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
      batch.set(relationRef, { type: "partner", first, second, root: false });
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

      batch.set(relationRef, { type: "parent", first, second, person: personRef, parentship, root: false });
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
  return (
    <Canvas>
      <ReactFlow
        className={editMode ? "genealogy-flow is-editing" : "genealogy-flow"}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={diagramNodes}
        edges={graph.edges}
        nodesConnectable={editMode}
        connectOnClick={false}
        onConnectEnd={onConnectEnd}
        colorMode="light"
        connectionLineStyle={{ stroke: "#3d5a4c", strokeWidth: 2 }}
        defaultEdgeOptions={{ zIndex: 2, style: { stroke: "#8a735a", strokeWidth: 1.6 } }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
        style={{ ["--xy-edge-stroke" as string]: "#8a735a" }}
      >
        <FitToTop ready={graph.nodes.length > 0} />
        <Background color="#d5cbb8" gap={28} size={1} />
        <DiagramPersonSearch nodes={graph.nodes} />
        <Panel position="bottom-left">
          <ModeControls className="nodrag nopan">
            <ModeControl>
              <ModeInput
                type="checkbox"
                checked={editMode}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setEditMode(enabled);
                  if (!enabled) {
                    setDraft(null);
                    setEditingPerson(null);
                  }
                }}
              />
              <ModeTrack aria-hidden="true" />
              <ModeLabel>Tryb edycji</ModeLabel>
            </ModeControl>
            <ModeControl>
              <ModeInput type="checkbox" checked={showBirthSurname} onChange={(event) => setShowBirthSurname(event.target.checked)} />
              <ModeTrack aria-hidden="true" />
              <ModeLabel>Nazwisko rodowe</ModeLabel>
            </ModeControl>
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
          onCancel={() => setEditingPerson(null)}
          onSave={(values) => savePerson(editingPerson.id, values)}
          onDelete={() => deletePerson(editingPerson)}
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
  onCancel,
  onSave,
  onDelete,
}: {
  person: Person;
  onCancel: () => void;
  onSave: (values: PersonFormValues) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [form, setForm] = useState(() => personToForm(person));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  return (
    <EditorDrawer className="nodrag nopan nowheel" onSubmit={handleSubmit}>
      <EditorHeader>
        <div>
          <EditorTitle>Edytuj osobę</EditorTitle>
          <EditorContext>{personName(person)}</EditorContext>
        </div>
        <CloseButton type="button" onClick={onCancel} disabled={saving || deleting} aria-label="Zamknij formularz" title="Zamknij">
          ×
        </CloseButton>
      </EditorHeader>

      <PersonFormFields value={form} onChange={setForm} idPrefix="edit-person" autoFocus />
      {error ? <EditorError>{error}</EditorError> : null}
      <EditorActions>
        <SaveButton type="submit" disabled={saving || deleting}>
          {saving ? "Zapisywanie…" : "Zapisz zmiany"}
        </SaveButton>
        <CancelButton type="button" onClick={onCancel} disabled={saving || deleting}>
          Anuluj
        </CancelButton>
        <DeletePersonButton type="button" onClick={() => void handleDelete()} disabled={saving || deleting}>
          {deleting ? "Usuwanie…" : "Usuń osobę"}
        </DeletePersonButton>
      </EditorActions>
    </EditorDrawer>
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
      await onSave(mode === "existing" ? { mode, personId } : { mode, person });
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
