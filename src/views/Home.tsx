import { Background, type Edge, type Node, type OnConnectEnd, Panel, ReactFlow } from "@xyflow/react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import styled from "styled-components";
import { FitToTop } from "@/components/FitToTop";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";
import type { PartnerRelation, Relation } from "@/entities/relation/types";
import { buildGenealogyGraph, edgeTypes, nodeTypes } from "@/features/genealogyLayout";
import { db } from "@/firebase";

import "@xyflow/react/dist/style.css";

type GenealogyLoaderData = {
  nodes: Node[];
  edges: Edge[];
  people: Person[];
  relations: Relation[];
};

type NewPersonValues = {
  biography: string;
  firstName: string;
  lastName: string;
  middleNames: string;
  birthDay: string;
  birthMonth: string;
  birthYear: string;
  birthPlace: string;
  birthSurname: string;
  deathDay: string;
  deathMonth: string;
  deathYear: string;
  deathPlace: string;
  photoUrl: string;
  sex: "female" | "male";
};

const emptyNewPerson = (): NewPersonValues => ({
  biography: "",
  firstName: "",
  lastName: "",
  middleNames: "",
  birthDay: "",
  birthMonth: "",
  birthYear: "",
  birthPlace: "",
  birthSurname: "",
  deathDay: "",
  deathMonth: "",
  deathYear: "",
  deathPlace: "",
  photoUrl: "",
  sex: "female",
});

function parseOptionalInt(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function buildPartialDate(day: string, month: string, year: string) {
  const parsedYear = parseOptionalInt(year);
  if (parsedYear === null) return null;
  return {
    day: parseOptionalInt(day),
    month: parseOptionalInt(month),
    year: parsedYear,
  };
}

function validatePartialDate(day: string, month: string, year: string, label: string): string | null {
  const hasAnyValue = Boolean(day.trim() || month.trim() || year.trim());
  if (!hasAnyValue) return null;
  const parsedDay = parseOptionalInt(day);
  const parsedMonth = parseOptionalInt(month);
  const parsedYear = parseOptionalInt(year);
  if (parsedYear === null || parsedYear < 1 || parsedYear > 9999) return `${label}: podaj poprawny rok.`;
  if (day.trim() && (parsedDay === null || parsedDay < 1 || parsedDay > 31)) return `${label}: dzień musi mieścić się w zakresie 1–31.`;
  if (month.trim() && (parsedMonth === null || parsedMonth < 1 || parsedMonth > 12)) return `${label}: miesiąc musi mieścić się w zakresie 1–12.`;
  return null;
}

type RelationTarget = { mode: "existing"; personId: string } | { mode: "new"; person: NewPersonValues };

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
  const { nodes: loadedNodes, edges: loadedEdges, people, relations } = useLoaderData<GenealogyLoaderData>();
  const revalidator = useRevalidator();
  const [graph, setGraph] = useState(() => ({ nodes: loadedNodes, edges: loadedEdges }));
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<RelationDraft | null>(null);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  useEffect(() => {
    setGraph({ nodes: loadedNodes, edges: loadedEdges });
  }, [loadedNodes, loadedEdges]);
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
    let createdRelation: Relation;

    if (target.mode === "new") {
      batch.set(personRef, {
        biography: target.person.biography.trim() || null,
        firstName: target.person.firstName.trim(),
        lastName: target.person.lastName.trim(),
        middleNames: target.person.middleNames
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
        birth: buildPartialDate(target.person.birthDay, target.person.birthMonth, target.person.birthYear),
        birthPlace: target.person.birthPlace.trim() || null,
        birthSurname: target.person.birthSurname.trim() || null,
        death: buildPartialDate(target.person.deathDay, target.person.deathMonth, target.person.deathYear),
        deathPlace: target.person.deathPlace.trim() || null,
        father: null,
        mother: null,
        photoUrl: target.person.photoUrl.trim() || null,
        sex: target.person.sex === "male",
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
      createdRelation = { id: relationRef.id, type: "partner", first, second, root: false };
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
      createdRelation = {
        id: relationRef.id,
        type: "parent",
        first,
        second,
        person: personRef,
        parentship,
        root: false,
      };
      batch.set(relationRef, { type: "parent", first, second, person: personRef, parentship, root: false });
    }

    await batch.commit();
    const nextGraph = await buildGenealogyGraph([...relations, createdRelation]);
    setGraph(nextGraph);
    setDraft(null);
    void revalidator.revalidate();
  };
  return (
    <Canvas>
      <ReactFlow
        className={editMode ? "genealogy-flow is-editing" : "genealogy-flow"}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={graph.nodes}
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
        <Panel position="bottom-left">
          <ModeControl className="nodrag nopan">
            <ModeInput
              type="checkbox"
              checked={editMode}
              onChange={(event) => {
                const enabled = event.target.checked;
                setEditMode(enabled);
                if (!enabled) setDraft(null);
              }}
            />
            <ModeTrack aria-hidden="true" />
            <ModeLabel>Tryb edycji</ModeLabel>
          </ModeControl>
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
    </Canvas>
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
  const [person, setPerson] = useState<NewPersonValues>(emptyNewPerson);
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
    if (mode === "new" && (!person.firstName.trim() || !person.lastName.trim())) {
      setError("Imię i nazwisko są wymagane.");
      return;
    }
    if (mode === "new") {
      const dateError =
        validatePartialDate(person.birthDay, person.birthMonth, person.birthYear, "Data urodzenia") ??
        validatePartialDate(person.deathDay, person.deathMonth, person.deathYear, "Data śmierci");
      if (dateError) {
        setError(dateError);
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
        <>
          <EditorGrid>
            <EditorField>
              <EditorLabel htmlFor="new-first-name">Imię *</EditorLabel>
              <EditorInput
                id="new-first-name"
                value={person.firstName}
                onChange={(event) => setPerson((current) => ({ ...current, firstName: event.target.value }))}
                autoFocus
                required
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-last-name">Nazwisko *</EditorLabel>
              <EditorInput
                id="new-last-name"
                value={person.lastName}
                onChange={(event) => setPerson((current) => ({ ...current, lastName: event.target.value }))}
                required
              />
            </EditorField>
            <EditorField $span>
              <EditorLabel htmlFor="new-middle-names">Drugie imiona</EditorLabel>
              <EditorInput
                id="new-middle-names"
                placeholder="oddzielone przecinkami"
                value={person.middleNames}
                onChange={(event) => setPerson((current) => ({ ...current, middleNames: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-birth-surname">Nazwisko rodowe</EditorLabel>
              <EditorInput
                id="new-birth-surname"
                value={person.birthSurname}
                onChange={(event) => setPerson((current) => ({ ...current, birthSurname: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-sex">Płeć</EditorLabel>
              <EditorSelect
                id="new-sex"
                value={person.sex}
                onChange={(event) => setPerson((current) => ({ ...current, sex: event.target.value as NewPersonValues["sex"] }))}
              >
                <option value="female">Kobieta</option>
                <option value="male">Mężczyzna</option>
              </EditorSelect>
            </EditorField>
          </EditorGrid>

          <EditorSectionLabel>Urodzenie</EditorSectionLabel>
          <EditorGrid>
            <EditorField>
              <EditorLabel htmlFor="new-birth-day">Dzień</EditorLabel>
              <EditorInput
                id="new-birth-day"
                inputMode="numeric"
                placeholder="dd"
                value={person.birthDay}
                onChange={(event) => setPerson((current) => ({ ...current, birthDay: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-birth-month">Miesiąc</EditorLabel>
              <EditorInput
                id="new-birth-month"
                inputMode="numeric"
                placeholder="mm"
                value={person.birthMonth}
                onChange={(event) => setPerson((current) => ({ ...current, birthMonth: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-birth-year">Rok</EditorLabel>
              <EditorInput
                id="new-birth-year"
                inputMode="numeric"
                placeholder="rrrr"
                value={person.birthYear}
                onChange={(event) => setPerson((current) => ({ ...current, birthYear: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-birth-place">Miejsce</EditorLabel>
              <EditorInput
                id="new-birth-place"
                value={person.birthPlace}
                onChange={(event) => setPerson((current) => ({ ...current, birthPlace: event.target.value }))}
              />
            </EditorField>
          </EditorGrid>

          <EditorSectionLabel>Śmierć</EditorSectionLabel>
          <EditorGrid>
            <EditorField>
              <EditorLabel htmlFor="new-death-day">Dzień</EditorLabel>
              <EditorInput
                id="new-death-day"
                inputMode="numeric"
                placeholder="dd"
                value={person.deathDay}
                onChange={(event) => setPerson((current) => ({ ...current, deathDay: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-death-month">Miesiąc</EditorLabel>
              <EditorInput
                id="new-death-month"
                inputMode="numeric"
                placeholder="mm"
                value={person.deathMonth}
                onChange={(event) => setPerson((current) => ({ ...current, deathMonth: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-death-year">Rok</EditorLabel>
              <EditorInput
                id="new-death-year"
                inputMode="numeric"
                placeholder="rrrr"
                value={person.deathYear}
                onChange={(event) => setPerson((current) => ({ ...current, deathYear: event.target.value }))}
              />
            </EditorField>
            <EditorField>
              <EditorLabel htmlFor="new-death-place">Miejsce</EditorLabel>
              <EditorInput
                id="new-death-place"
                value={person.deathPlace}
                onChange={(event) => setPerson((current) => ({ ...current, deathPlace: event.target.value }))}
              />
            </EditorField>
          </EditorGrid>

          <EditorSectionLabel>Informacje dodatkowe</EditorSectionLabel>
          <EditorGrid>
            <EditorField $span>
              <EditorLabel htmlFor="new-photo-url">URL zdjęcia</EditorLabel>
              <EditorInput
                id="new-photo-url"
                type="url"
                placeholder="https://…"
                value={person.photoUrl}
                onChange={(event) => setPerson((current) => ({ ...current, photoUrl: event.target.value }))}
              />
            </EditorField>
            <EditorField $span>
              <EditorLabel htmlFor="new-biography">Biografia</EditorLabel>
              <EditorTextarea
                id="new-biography"
                rows={4}
                value={person.biography}
                onChange={(event) => setPerson((current) => ({ ...current, biography: event.target.value }))}
              />
            </EditorField>
          </EditorGrid>
        </>
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
  height: 100vh;
  background: #f3efe8;
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
  top: 2.75rem;
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

const EditorSectionLabel = styled.h3`
  margin: 1rem 0 0.5rem;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
`;

const EditorGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
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

const editorControlStyles = `
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
  font-size: 0.9rem;
  outline: none;

  &:focus {
    border-color: var(--accent);
  }
`;

const EditorInput = styled.input`
  ${editorControlStyles}
`;

const EditorSelect = styled.select`
  ${editorControlStyles}
`;

const EditorTextarea = styled.textarea`
  ${editorControlStyles}
  min-height: 6rem;
  resize: vertical;
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
