import { addDoc, collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import styled from "styled-components";
import { PersonFormFields } from "@/components/PersonFormFields";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { matchesPersonQuery, personDatesOrId, personLabel, personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";
import type { Relation } from "@/entities/relation/types";
import { deletePersonWithRelations, getPersonDeletionImpact } from "@/features/personDeletion";
import { emptyPersonForm, type PersonFormValues, personFormPayload, personToForm, validatePersonForm } from "@/features/personForm";
import { db } from "@/firebase";

const PERSON_PAGE_SIZE = 20;

type RelationFormValues = {
  type: "partner" | "parent";
  firstId: string;
  secondId: string;
  root: boolean;
  personId: string;
  parentshipId: string;
};

const emptyRelationForm = (): RelationFormValues => ({
  type: "partner",
  firstId: "",
  secondId: "",
  root: false,
  personId: "",
  parentshipId: "",
});

function refId(value: { id?: string } | null | undefined) {
  return value?.id ?? null;
}

export function Dashboard() {
  const loaderData = useLoaderData<{ relations: Relation[]; people: Person[] }>();
  const revalidator = useRevalidator();
  const [people, setPeople] = useState(loaderData.people);
  const [relations, setRelations] = useState(loaderData.relations);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(loaderData.people[0]?.id ?? null);
  const [activeDrawer, setActiveDrawer] = useState<"person" | "relation" | null>(null);

  useEffect(() => {
    if (!activeDrawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveDrawer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeDrawer]);

  useEffect(() => {
    setPeople(loaderData.people);
    setRelations(loaderData.relations);
    setSelectedPersonId((current) => (current && loaderData.people.some((person) => person.id === current) ? current : (loaderData.people[0]?.id ?? null)));
  }, [loaderData]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const selectedPerson = selectedPersonId ? (peopleById.get(selectedPersonId) ?? null) : null;
  const refresh = () => void revalidator.revalidate();

  return (
    <Page>
      <Header>
        <HeaderCopy>
          <Title>Osoby</Title>
          <Subtitle>
            {people.length} osób · {relations.length} relacji
          </Subtitle>
        </HeaderCopy>
        <HeaderActions>
          <PrimaryAction type="button" onClick={() => setActiveDrawer("person")}>
            Dodaj osobę
          </PrimaryAction>
          <SecondaryAction type="button" onClick={() => setActiveDrawer("relation")}>
            Dodaj relację
          </SecondaryAction>
        </HeaderActions>
      </Header>

      <PeopleWorkspace>
        <PersonList
          people={people}
          relations={relations}
          selectedPersonId={selectedPersonId}
          onSelect={setSelectedPersonId}
          onDeleted={(personId, nextRelations) => {
            const nextPeople = people
              .filter((person) => person.id !== personId)
              .map((person) => ({
                ...person,
                father: person.father?.id === personId ? null : person.father,
                mother: person.mother?.id === personId ? null : person.mother,
              }));
            setPeople(nextPeople);
            setRelations(nextRelations);
            setSelectedPersonId((current) => (current === personId ? (nextPeople[0]?.id ?? null) : current));
            refresh();
          }}
        />
        {selectedPerson ? (
          <PersonEditor
            key={selectedPerson.id}
            person={selectedPerson}
            onSaved={(updatedPerson) => {
              setPeople((current) => current.map((person) => (person.id === updatedPerson.id ? updatedPerson : person)));
              refresh();
            }}
          />
        ) : (
          <EmptyEditor>
            <EmptyEditorTitle>Nie wybrano osoby</EmptyEditorTitle>
          </EmptyEditor>
        )}
      </PeopleWorkspace>

      <RelationsSection>
        <RelationsHeader>
          <div>
            <SectionHeading>Relacje</SectionHeading>
            <SectionDescription>{relations.length} rekordów wykorzystywanych przez drzewo</SectionDescription>
          </div>
        </RelationsHeader>
        <RelationList
          relations={relations}
          peopleById={peopleById}
          onDeleted={(nextRelations) => {
            setRelations(nextRelations);
            refresh();
          }}
        />
      </RelationsSection>

      {activeDrawer ? (
        <DrawerBackdrop onMouseDown={() => setActiveDrawer(null)}>
          <DrawerPanel
            role="dialog"
            aria-modal="true"
            aria-label={activeDrawer === "person" ? "Dodaj osobę" : "Dodaj relację"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {activeDrawer === "person" ? (
              <PersonForm
                onCancel={() => setActiveDrawer(null)}
                onCreated={(personId) => {
                  setSelectedPersonId(personId);
                  setActiveDrawer(null);
                  refresh();
                }}
              />
            ) : (
              <RelationForm
                people={people}
                relations={relations}
                onCancel={() => setActiveDrawer(null)}
                onCreated={(relation) => {
                  setRelations((current) => [...current, relation]);
                  setActiveDrawer(null);
                  refresh();
                }}
              />
            )}
          </DrawerPanel>
        </DrawerBackdrop>
      ) : null}
    </Page>
  );
}
function PersonForm({ onCreated, onCancel }: { onCreated: (personId: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState<PersonFormValues>(emptyPersonForm);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validatePersonForm(form);
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      const reference = await addDoc(collection(db, "people"), {
        ...personFormPayload(form),
        father: null,
        mother: null,
        createdAt: serverTimestamp(),
      });
      onCreated(reference.id);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Nie udało się zapisać osoby.");
    }
  };

  return (
    <DrawerForm onSubmit={handleSubmit}>
      <DrawerHeader>
        <div>
          <CardTitle>Dodaj osobę</CardTitle>
          <CardHint>Dane nowego członka rodziny</CardHint>
        </div>
        <DrawerClose type="button" onClick={onCancel} aria-label="Zamknij formularz" title="Zamknij">
          ×
        </DrawerClose>
      </DrawerHeader>
      <PersonFormFields value={form} onChange={setForm} idPrefix="dashboard-new-person" autoFocus />
      <Actions>
        <Submit type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Zapisywanie…" : "Dodaj osobę"}
        </Submit>
        <CancelAction type="button" onClick={onCancel} disabled={status === "saving"}>
          Anuluj
        </CancelAction>
        {status === "error" && error ? <Status>{error}</Status> : null}
      </Actions>
    </DrawerForm>
  );
}

function PersonEditor({ person, onSaved }: { person: Person; onSaved: (person: Person) => void }) {
  const [form, setForm] = useState(() => personToForm(person));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(personToForm(person));
    setStatus("idle");
    setError(null);
  }, [person]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validatePersonForm(form);
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      const payload = personFormPayload(form);
      await updateDoc(doc(db, "people", person.id), { ...payload, updatedAt: serverTimestamp() });
      onSaved({
        ...person,
        ...payload,
        birth: payload.birth as Person["birth"],
        death: payload.death as Person["death"],
      });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Nie udało się zaktualizować osoby.");
    }
  };

  return (
    <EditorPanel as="form" onSubmit={handleSubmit}>
      <EditorPanelHeader>
        <div>
          <CardTitle>Edytuj osobę</CardTitle>
          <CardHint>{personName(person)}</CardHint>
        </div>
        <PersonId>{person.id}</PersonId>
      </EditorPanelHeader>
      <PersonFormFields value={form} onChange={setForm} idPrefix={`dashboard-edit-${person.id}`} />
      <Actions>
        <Submit type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Zapisywanie…" : "Zapisz zmiany"}
        </Submit>
        {status === "saved" ? <Status $ok>Zapisano</Status> : null}
        {status === "error" && error ? <Status>{error}</Status> : null}
      </Actions>
    </EditorPanel>
  );
}
function PersonList({
  people,
  relations,
  selectedPersonId,
  onSelect,
  onDeleted,
}: {
  people: Person[];
  relations: Relation[];
  selectedPersonId: string | null;
  onSelect: (personId: string) => void;
  onDeleted: (personId: string, nextRelations: Relation[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [deletingPersonId, setDeletingPersonId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () => people.filter((person) => matchesPersonQuery(person, query)).sort((first, second) => personName(first).localeCompare(personName(second), "pl")),
    [people, query],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PERSON_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visiblePeople = filtered.slice(currentPage * PERSON_PAGE_SIZE, (currentPage + 1) * PERSON_PAGE_SIZE);

  const handleDelete = async (person: Person) => {
    const impact = getPersonDeletionImpact(person, people, relations);
    const details = [
      `Relacje do usunięcia: ${impact.relationsToDelete}.`,
      `Relacje do aktualizacji: ${impact.relationsToUpdate}.`,
      `Pola rodziców do wyczyszczenia: ${impact.parentLinksToClear}.`,
    ].join("\n");
    const rootWarning = impact.deletesRootRelation ? "\n\nUwaga: wraz z osobą zostanie usunięta relacja root drzewa." : "";

    if (!window.confirm(`Usunąć osobę „${personName(person)}”?\n\n${details}${rootWarning}\n\nTej operacji nie można cofnąć.`)) return;

    setDeletingPersonId(person.id);
    setDeleteError(null);

    try {
      const result = await deletePersonWithRelations(person, people, relations);
      onDeleted(person.id, result.relations);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Nie udało się usunąć osoby.");
    } finally {
      setDeletingPersonId(null);
    }
  };

  return (
    <Card>
      <CardTitle>Lista osób</CardTitle>
      <CardHint>
        {filtered.length}
        {query.trim() ? ` z ${people.length}` : ""} rekordów
      </CardHint>
      <ListSearch
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
        placeholder="Szukaj po imieniu, dacie, miejscu lub ID…"
      />
      {deleteError ? <DeleteStatus>{deleteError}</DeleteStatus> : null}
      {people.length === 0 ? (
        <Empty>Brak osób.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>Brak wyników dla „{query.trim()}”.</Empty>
      ) : (
        <List>
          {visiblePeople.map((person) => {
            const hint = personDatesOrId(person);
            return (
              <ListItem key={person.id} $selected={person.id === selectedPersonId}>
                <ListItemRow>
                  <PersonSelectButton type="button" onClick={() => onSelect(person.id)} aria-pressed={person.id === selectedPersonId}>
                    <ItemTitle>
                      {personName(person)}
                      {" — "}
                      <PersonHint>{hint.text}</PersonHint>
                    </ItemTitle>
                    <ItemMeta>{[person.birthPlace, person.deathPlace ? `† ${person.deathPlace}` : null].filter(Boolean).join(" · ") || "—"}</ItemMeta>
                  </PersonSelectButton>
                  <DeleteButton
                    type="button"
                    disabled={deletingPersonId !== null}
                    onClick={() => void handleDelete(person)}
                    aria-label={`Usuń osobę ${personName(person)}`}
                  >
                    {deletingPersonId === person.id ? "Usuwanie…" : "Usuń"}
                  </DeleteButton>
                </ListItemRow>
              </ListItem>
            );
          })}
        </List>
      )}
      {filtered.length > PERSON_PAGE_SIZE ? (
        <ListPagination aria-label="Strony listy osób">
          <PageButton type="button" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} aria-label="Poprzednia strona">
            ‹
          </PageButton>
          <PageStatus>
            {currentPage + 1} / {totalPages}
          </PageStatus>
          <PageButton
            type="button"
            disabled={currentPage === totalPages - 1}
            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
            aria-label="Następna strona"
          >
            ›
          </PageButton>
        </ListPagination>
      ) : null}
    </Card>
  );
}
function RelationForm({
  people,
  relations,
  onCreated,
  onCancel,
}: {
  people: Person[];
  relations: Relation[];
  onCreated: (relation: Relation) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RelationFormValues>(emptyRelationForm);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const partnerRelations = useMemo(() => relations.filter((relation) => relation.type === "partner"), [relations]);

  const matchedParentshipId = useMemo(() => {
    if (!form.firstId || !form.secondId) return "";
    const match = partnerRelations.find((relation) => {
      const a = relation.first.id;
      const b = relation.second?.id;
      return (a === form.firstId && b === form.secondId) || (a === form.secondId && b === form.firstId);
    });
    return match?.id ?? "";
  }, [form.firstId, form.secondId, partnerRelations]);

  useEffect(() => {
    if (form.type !== "parent") return;
    setForm((prev) => (prev.parentshipId === matchedParentshipId ? prev : { ...prev, parentshipId: matchedParentshipId }));
  }, [form.type, matchedParentshipId]);

  const update = <K extends keyof RelationFormValues>(key: K, value: RelationFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (status !== "idle") {
      setStatus("idle");
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!form.firstId) {
      setStatus("error");
      setError("Wybierz pierwszą osobę (first).");
      return;
    }

    if (form.type === "parent" && !form.personId) {
      setStatus("error");
      setError("Relacja parent wymaga wskazania dziecka (person).");
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      const first = doc(db, "people", form.firstId);
      const second = form.secondId ? doc(db, "people", form.secondId) : null;

      if (form.type === "partner") {
        const ref = await addDoc(collection(db, "relations"), {
          type: "partner" as const,
          first,
          second,
          root: form.root,
        });
        onCreated({
          id: ref.id,
          type: "partner",
          first,
          second,
          root: form.root,
        });
      } else {
        const parentship = form.parentshipId ? doc(db, "relations", form.parentshipId) : null;
        const person = doc(db, "people", form.personId);
        const ref = await addDoc(collection(db, "relations"), {
          type: "parent" as const,
          first,
          second,
          root: form.root,
          person,
          parentship,
        });
        onCreated({
          id: ref.id,
          type: "parent",
          first,
          second,
          root: form.root,
          person,
          parentship,
        });
      }

      setForm(emptyRelationForm());
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Nie udało się zapisać relacji.");
    }
  };

  return (
    <DrawerForm onSubmit={handleSubmit}>
      <DrawerHeader>
        <div>
          <CardTitle>Dodaj relację</CardTitle>
          <CardHint>Powiązanie osób w drzewie</CardHint>
        </div>
        <DrawerClose type="button" onClick={onCancel} aria-label="Zamknij formularz" title="Zamknij">
          ×
        </DrawerClose>
      </DrawerHeader>

      <FieldGrid>
        <Field $span={2}>
          <Label htmlFor="relationType">Typ *</Label>
          <Select id="relationType" value={form.type} onChange={(e) => update("type", e.target.value as "partner" | "parent")}>
            <option value="partner">partner — związek</option>
            <option value="parent">parent — dziecko ↔ rodzice / parentship</option>
          </Select>
        </Field>

        <Field>
          <Label htmlFor="firstId">First *</Label>
          <PersonSearchSelect
            id="firstId"
            people={people}
            value={form.firstId}
            onChange={(personId) => update("firstId", personId)}
            required
            placeholder="Szukaj first…"
          />
        </Field>

        <Field>
          <Label htmlFor="secondId">Second</Label>
          <PersonSearchSelect
            id="secondId"
            people={people}
            value={form.secondId}
            onChange={(personId) => update("secondId", personId)}
            allowEmpty
            emptyLabel="— brak —"
            placeholder="Szukaj second…"
          />
        </Field>

        <Field $span={2}>
          <CheckboxRow>
            <input id="root" type="checkbox" checked={form.root} onChange={(e) => update("root", e.target.checked)} />
            <Label htmlFor="root">Root (punkt startowy drzewa)</Label>
          </CheckboxRow>
        </Field>
      </FieldGrid>

      {form.type === "parent" ? (
        <>
          <SectionLabel>Parent</SectionLabel>
          <FieldGrid>
            <Field $span={2}>
              <Label htmlFor="personId">Dziecko (person) *</Label>
              <PersonSearchSelect
                id="personId"
                people={people}
                value={form.personId}
                onChange={(personId) => update("personId", personId)}
                required
                placeholder="Szukaj dziecka…"
              />
            </Field>
            <Field $span={2}>
              <Label htmlFor="parentshipId">Parentship (relacja partner)</Label>
              <Select id="parentshipId" value={form.parentshipId} onChange={(e) => update("parentshipId", e.target.value)}>
                <option value="">— brak (linie bezpośrednio do first/second) —</option>
                {partnerRelations.map((relation) => {
                  const first = people.find((person) => person.id === relation.first.id);
                  const second = relation.second?.id ? people.find((person) => person.id === relation.second?.id) : null;
                  const label = [first ? personLabel(first) : relation.first.id, second ? personLabel(second) : null].filter(Boolean).join(" · ");
                  return (
                    <option key={relation.id} value={relation.id}>
                      {label || relation.id}
                    </option>
                  );
                })}
              </Select>
              <CardHint>
                {matchedParentshipId ? "Dopasowano automatycznie na podstawie first + second." : "Wybierz first i second, aby spróbować dopasować parentship."}
              </CardHint>
            </Field>
          </FieldGrid>
        </>
      ) : null}

      <Actions>
        <Submit type="submit" disabled={status === "saving" || people.length === 0}>
          {status === "saving" ? "Zapisywanie…" : "Dodaj relację"}
        </Submit>
        <CancelAction type="button" onClick={onCancel} disabled={status === "saving"}>
          Anuluj
        </CancelAction>
        {people.length === 0 ? <Status>Najpierw dodaj osoby.</Status> : null}
        {status === "saved" ? <Status $ok>Zapisano</Status> : null}
        {status === "error" && error ? <Status>{error}</Status> : null}
      </Actions>
    </DrawerForm>
  );
}

function RelationList({
  relations,
  peopleById,
  onDeleted,
}: {
  relations: Relation[];
  peopleById: Map<string, Person>;
  onDeleted: (nextRelations: Relation[]) => void;
}) {
  const [deletingRelationId, setDeletingRelationId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const personRefLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const person = peopleById.get(id);
    if (!person) return id;
    const hint = personDatesOrId(person);
    return (
      <>
        {personName(person)}
        {" — "}
        <PersonHint>{hint.text}</PersonHint>
      </>
    );
  };

  const handleDelete = async (relation: Relation) => {
    const dependentParents =
      relation.type === "partner" ? relations.filter((candidate) => candidate.type === "parent" && refId(candidate.parentship) === relation.id) : [];
    const rootWarning = relation.root ? "\n\nUwaga: to relacja root. Po jej usunięciu trzeba wskazać nowy punkt startowy drzewa." : "";
    const dependentSummary = dependentParents.length > 0 ? `\nPowiązania parentship do wyczyszczenia: ${dependentParents.length}.` : "";

    if (!window.confirm(`Usunąć relację „${relation.type}”?${dependentSummary}${rootWarning}\n\nTej operacji nie można cofnąć.`)) return;

    setDeletingRelationId(relation.id);
    setDeleteError(null);

    try {
      const batch = writeBatch(db);
      for (const dependent of dependentParents) {
        batch.update(doc(db, "relations", dependent.id), { parentship: null });
      }
      batch.delete(doc(db, "relations", relation.id));
      await batch.commit();

      const dependentIds = new Set(dependentParents.map((dependent) => dependent.id));
      onDeleted(
        relations
          .filter((candidate) => candidate.id !== relation.id)
          .map((candidate) => (candidate.type === "parent" && dependentIds.has(candidate.id) ? { ...candidate, parentship: null } : candidate)),
      );
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Nie udało się usunąć relacji.");
    } finally {
      setDeletingRelationId(null);
    }
  };

  return (
    <Card>
      <CardTitle>Lista relacji</CardTitle>
      <CardHint>{relations.length} rekordów</CardHint>
      {deleteError ? <DeleteStatus>{deleteError}</DeleteStatus> : null}
      {relations.length === 0 ? (
        <Empty>Brak relacji.</Empty>
      ) : (
        <List>
          {relations.map((relation) => (
            <ListItem key={relation.id}>
              <ListItemRow>
                <ListItemContent>
                  <ItemTitle>
                    <TypeBadge $type={relation.type}>{relation.type}</TypeBadge>
                    {relation.root ? <RootBadge>root</RootBadge> : null}
                    {relation.id}
                  </ItemTitle>
                  <ItemMeta>
                    first: {personRefLabel(refId(relation.first))}
                    {" · "}
                    second: {personRefLabel(refId(relation.second))}
                  </ItemMeta>
                  {relation.type === "parent" ? (
                    <ItemMeta>
                      person: {personRefLabel(refId(relation.person))}
                      {" · "}
                      parentship: {refId(relation.parentship) ?? "—"}
                    </ItemMeta>
                  ) : null}
                </ListItemContent>
                <DeleteButton
                  type="button"
                  disabled={deletingRelationId !== null}
                  onClick={() => void handleDelete(relation)}
                  aria-label={`Usuń relację ${relation.type}`}
                >
                  {deletingRelationId === relation.id ? "Usuwanie…" : "Usuń"}
                </DeleteButton>
              </ListItemRow>
            </ListItem>
          ))}
        </List>
      )}
    </Card>
  );
}
const Page = styled.div`
  --ink: #1c2a22;
  --muted: #5c6b62;
  --paper: #f7f4ef;
  --line: #c5b8a4;
  --accent: #3d5a4c;
  --page: #f3efe8;

  min-height: 100%;
  padding: 2rem 1.5rem 3rem;
  background: var(--page);
  color: var(--ink);
`;

const Header = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  max-width: 1280px;
  margin: 0 auto 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--line);

  @media (max-width: 720px) {
    flex-direction: column;
  }
`;

const HeaderCopy = styled.div`
  max-width: 44rem;
`;

const HeaderActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
`;

const actionStyles = `
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
`;

const PrimaryAction = styled.button`
  ${actionStyles}
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
`;

const SecondaryAction = styled.button`
  ${actionStyles}
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);

  &:hover {
    border-color: var(--accent);
  }
`;

const PeopleWorkspace = styled.section`
  display: grid;
  grid-template-columns: minmax(19rem, 0.7fr) minmax(0, 1.3fr);
  align-items: start;
  gap: 1rem;
  max-width: 1280px;
  margin: 0 auto 2rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const EditorPanel = styled.div`
  min-width: 0;
  border: 1px solid var(--line);
  border-top: 3px solid #6b4f3a;
  background: var(--paper);
  padding: 1.25rem;
  box-shadow: 0 1px 0 rgba(28, 42, 34, 0.06);
`;

const EditorPanelHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--line);
`;

const PersonId = styled.code`
  max-width: 45%;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyEditor = styled.div`
  min-height: 18rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--line);
  background: rgba(247, 244, 239, 0.55);
  padding: 2rem;
  text-align: center;
`;

const EmptyEditorTitle = styled.h2`
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
`;

const RelationsSection = styled.section`
  max-width: 1280px;
  margin: 0 auto;
`;

const RelationsHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
`;

const SectionHeading = styled.h2`
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
`;
const SectionDescription = styled.p`
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
`;

const DrawerBackdrop = styled.div`
  position: fixed;
  z-index: 90;
  top: 4rem;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: flex-end;
  background: rgba(28, 42, 34, 0.28);
`;

const DrawerPanel = styled.aside`
  width: min(44rem, 100vw);
  height: 100%;
  overflow: auto;
  border-left: 1px solid var(--line);
  background: var(--paper);
  box-shadow: -12px 0 32px rgba(28, 42, 34, 0.18);
`;

const DrawerForm = styled.form`
  padding: 1.25rem;
`;

const DrawerHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--line);
`;

const DrawerClose = styled.button`
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--muted);
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    border-color: var(--accent);
    color: var(--ink);
    outline: none;
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  font-weight: 500;
`;

const Subtitle = styled.p`
  margin: 0.35rem 0 0;
  color: var(--muted);
  font-size: 0.95rem;
`;

const Card = styled.div`
  background: var(--paper);
  border: 1px solid var(--line);
  border-top: 3px solid var(--accent);
  padding: 1.25rem 1.35rem 1.5rem;
  box-shadow: 0 1px 0 rgba(28, 42, 34, 0.06);
`;

const CardTitle = styled.h2`
  margin: 0;
  font-size: 1.15rem;
  font-weight: 500;
`;

const CardHint = styled.p`
  margin: 0.25rem 0 1.15rem;
  color: var(--muted);
  font-size: 0.8rem;
`;

const SectionLabel = styled.h3`
  margin: 1.1rem 0 0.55rem;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 0.9rem;
`;

const Field = styled.div<{ $span?: 1 | 2 }>`
  grid-column: span ${({ $span = 1 }) => $span};
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const Label = styled.label`
  font-size: 0.78rem;
  color: var(--muted);
`;

const CheckboxRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.4rem;

  input {
    width: 1rem;
    height: 1rem;
    accent-color: var(--accent);
  }

  ${Label} {
    margin: 0;
    color: var(--ink);
    font-size: 0.9rem;
  }
`;

const inputStyles = `
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--accent);
  }
`;

const Select = styled.select`
  ${inputStyles}
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.25rem;
`;

const Submit = styled.button`
  border: none;
  background: var(--accent);
  color: #f7f4ef;
  padding: 0.65rem 1.15rem;
  font: inherit;
  font-size: 0.95rem;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const CancelAction = styled.button`
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 0.65rem 1rem;
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;
const Status = styled.span<{ $ok?: boolean }>`
  font-size: 0.85rem;
  color: ${({ $ok }) => ($ok ? "var(--accent)" : "#8b3a2a")};
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  max-height: 70vh;
  overflow: auto;
`;

const ListSearch = styled.input`
  ${inputStyles}
  margin-bottom: 0.75rem;
`;

const ListItem = styled.li<{ $selected?: boolean }>`
  padding: 0.65rem 0.75rem;
  border: 1px solid ${({ $selected }) => ($selected ? "var(--accent)" : "var(--line)")};
  background: ${({ $selected }) => ($selected ? "#e8efe9" : "#fff")};
`;

const ListItemRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
`;

const PersonSelectButton = styled.button`
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
`;
const ListItemContent = styled.div`
  min-width: 0;
`;

const DeleteButton = styled.button`
  border: 1px solid #a95747;
  background: #fff;
  color: #8b3a2a;
  padding: 0.4rem 0.6rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;

  &:hover:not(:disabled) {
    background: #8b3a2a;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #8b3a2a;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const ListPagination = styled.nav`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
`;

const PageButton = styled.button`
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 1.2rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const PageStatus = styled.span`
  min-width: 3.5rem;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;
const DeleteStatus = styled.p`
  margin: 0 0 0.75rem;
  color: #8b3a2a;
  font-size: 0.82rem;
`;

const ItemTitle = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
`;

const ItemMeta = styled.div`
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--muted);
`;

const PersonHint = styled.span`
  text-decoration: underline;
  text-underline-offset: 0.12em;
  font-variant-numeric: tabular-nums;
`;

const TypeBadge = styled.span<{ $type: "partner" | "parent" }>`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--line);
  background: ${({ $type }) => ($type === "partner" ? "#e8efe9" : "#efe8dc")};
  font-size: 0.72rem;
  letter-spacing: 0.02em;
`;

const RootBadge = styled.span`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  background: var(--accent);
  color: #f7f4ef;
  font-size: 0.72rem;
`;

const Empty = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
`;
