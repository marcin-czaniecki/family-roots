import { addDoc, collection, doc, serverTimestamp, Timestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import styled from "styled-components";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { matchesPersonQuery, personDatesOrId, personLabel, personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";
import type { Relation } from "@/entities/relation/types";
import { db } from "@/firebase";

type PersonFormValues = {
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
  sex: "male" | "female";
};

type RelationFormValues = {
  type: "partner" | "parent";
  firstId: string;
  secondId: string;
  root: boolean;
  personId: string;
  parentshipId: string;
};

const emptyPersonForm = (): PersonFormValues => ({
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

const emptyRelationForm = (): RelationFormValues => ({
  type: "partner",
  firstId: "",
  secondId: "",
  root: false,
  personId: "",
  parentshipId: "",
});

function parseOptionalInt(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildPartialDate(day: string, month: string, year: string) {
  const y = parseOptionalInt(year);
  if (y === null) return null;
  return {
    day: parseOptionalInt(day),
    month: parseOptionalInt(month),
    year: y,
  };
}

function toPersonPayload(form: PersonFormValues) {
  const middleNames = form.middleNames
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    biography: form.biography.trim() || null,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    middleNames,
    birth: buildPartialDate(form.birthDay, form.birthMonth, form.birthYear),
    birthPlace: form.birthPlace.trim() || null,
    birthSurname: form.birthSurname.trim() || null,
    death: buildPartialDate(form.deathDay, form.deathMonth, form.deathYear),
    deathPlace: form.deathPlace.trim() || null,
    father: null,
    mother: null,
    photoUrl: form.photoUrl.trim() || null,
    sex: form.sex === "male",
    createdAt: serverTimestamp(),
  };
}

function refId(value: { id?: string } | null | undefined) {
  return value?.id ?? null;
}

export function Dashboard() {
  const loaderData = useLoaderData<{ relations: Relation[]; people: Person[] }>();
  const revalidator = useRevalidator();
  const [people, setPeople] = useState(loaderData.people);
  const [relations, setRelations] = useState(loaderData.relations);

  useEffect(() => {
    setPeople(loaderData.people);
    setRelations(loaderData.relations);
  }, [loaderData]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const refresh = () => {
    void revalidator.revalidate();
  };

  return (
    <Page>
      <Header>
        <Title>Panel danych</Title>
        <Subtitle>Osoby (people) i relacje (relations)</Subtitle>
      </Header>

      <Section>
        <SectionHeading>Osoby</SectionHeading>
        <Layout>
          <PersonForm
            onCreated={(person) => {
              setPeople((prev) => [...prev, person]);
              refresh();
            }}
          />
          <PersonList people={people} />
        </Layout>
      </Section>

      <Section>
        <SectionHeading>Relacje</SectionHeading>
        <Layout>
          <RelationForm
            people={people}
            relations={relations}
            onCreated={(relation) => {
              setRelations((prev) => [...prev, relation]);
              refresh();
            }}
          />
          <RelationList relations={relations} peopleById={peopleById} />
        </Layout>
      </Section>
    </Page>
  );
}

function PersonForm({ onCreated }: { onCreated: (person: Person) => void }) {
  const [form, setForm] = useState<PersonFormValues>(emptyPersonForm);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof PersonFormValues>(key: K, value: PersonFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (status !== "idle") {
      setStatus("idle");
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setStatus("error");
      setError("Imię i nazwisko są wymagane.");
      return;
    }

    setStatus("saving");
    setError(null);
    try {
      const payload = toPersonPayload(form);
      const ref = await addDoc(collection(db, "people"), payload);
      onCreated({
        id: ref.id,
        biography: payload.biography,
        firstName: payload.firstName,
        lastName: payload.lastName,
        middleNames: payload.middleNames,
        birth: payload.birth as Person["birth"],
        birthPlace: payload.birthPlace,
        birthSurname: payload.birthSurname,
        death: payload.death as Person["death"],
        deathPlace: payload.deathPlace,
        father: null,
        mother: null,
        photoUrl: payload.photoUrl,
        sex: payload.sex,
        createdAt: Timestamp.now(),
      });
      setForm(emptyPersonForm());
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Nie udało się zapisać osoby.");
    }
  };

  return (
    <Card as="form" onSubmit={handleSubmit}>
      <CardTitle>Nowa osoba</CardTitle>
      <CardHint>Zapis do Firestore → people</CardHint>

      <FieldGrid>
        <Field>
          <Label htmlFor="firstName">Imię *</Label>
          <Input id="firstName" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} required />
        </Field>
        <Field>
          <Label htmlFor="lastName">Nazwisko *</Label>
          <Input id="lastName" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} required />
        </Field>
        <Field $span={2}>
          <Label htmlFor="middleNames">Drugie imiona</Label>
          <Input id="middleNames" placeholder="oddzielone przecinkami" value={form.middleNames} onChange={(e) => update("middleNames", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="birthSurname">Nazwisko rodowe</Label>
          <Input id="birthSurname" value={form.birthSurname} onChange={(e) => update("birthSurname", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="sex">Płeć</Label>
          <Select id="sex" value={form.sex} onChange={(e) => update("sex", e.target.value as "male" | "female")}>
            <option value="female">Kobieta</option>
            <option value="male">Mężczyzna</option>
          </Select>
        </Field>
      </FieldGrid>

      <SectionLabel>Urodzenie</SectionLabel>
      <FieldGrid>
        <Field>
          <Label htmlFor="birthDay">Dzień</Label>
          <Input id="birthDay" inputMode="numeric" placeholder="dd" value={form.birthDay} onChange={(e) => update("birthDay", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="birthMonth">Miesiąc</Label>
          <Input id="birthMonth" inputMode="numeric" placeholder="mm" value={form.birthMonth} onChange={(e) => update("birthMonth", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="birthYear">Rok</Label>
          <Input id="birthYear" inputMode="numeric" placeholder="rrrr" value={form.birthYear} onChange={(e) => update("birthYear", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="birthPlace">Miejsce</Label>
          <Input id="birthPlace" value={form.birthPlace} onChange={(e) => update("birthPlace", e.target.value)} />
        </Field>
      </FieldGrid>

      <SectionLabel>Śmierć</SectionLabel>
      <FieldGrid>
        <Field>
          <Label htmlFor="deathDay">Dzień</Label>
          <Input id="deathDay" inputMode="numeric" placeholder="dd" value={form.deathDay} onChange={(e) => update("deathDay", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="deathMonth">Miesiąc</Label>
          <Input id="deathMonth" inputMode="numeric" placeholder="mm" value={form.deathMonth} onChange={(e) => update("deathMonth", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="deathYear">Rok</Label>
          <Input id="deathYear" inputMode="numeric" placeholder="rrrr" value={form.deathYear} onChange={(e) => update("deathYear", e.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="deathPlace">Miejsce</Label>
          <Input id="deathPlace" value={form.deathPlace} onChange={(e) => update("deathPlace", e.target.value)} />
        </Field>
      </FieldGrid>

      <FieldGrid>
        <Field $span={2}>
          <Label htmlFor="photoUrl">URL zdjęcia</Label>
          <Input id="photoUrl" type="url" placeholder="https://…" value={form.photoUrl} onChange={(e) => update("photoUrl", e.target.value)} />
        </Field>
        <Field $span={2}>
          <Label htmlFor="biography">Biografia</Label>
          <Textarea id="biography" rows={4} value={form.biography} onChange={(e) => update("biography", e.target.value)} />
        </Field>
      </FieldGrid>

      <Actions>
        <Submit type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Zapisywanie…" : "Dodaj osobę"}
        </Submit>
        {status === "saved" ? <Status $ok>Zapisano</Status> : null}
        {status === "error" && error ? <Status>{error}</Status> : null}
      </Actions>
    </Card>
  );
}

function PersonList({ people }: { people: Person[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => people.filter((person) => matchesPersonQuery(person, query)), [people, query]);

  return (
    <Card>
      <CardTitle>Lista osób</CardTitle>
      <CardHint>
        {filtered.length}
        {query.trim() ? ` z ${people.length}` : ""} rekordów
      </CardHint>
      <ListSearch type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtruj listę (imię, data, id)…" />
      {people.length === 0 ? (
        <Empty>Brak osób w kolekcji people.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>Brak wyników dla „{query.trim()}”.</Empty>
      ) : (
        <List>
          {filtered.map((person) => {
            const hint = personDatesOrId(person);
            return (
              <ListItem key={person.id}>
                <ItemTitle>
                  {personName(person)}
                  {" — "}
                  <PersonHint>{hint.text}</PersonHint>
                </ItemTitle>
                <ItemMeta>{[person.birthPlace, person.deathPlace ? `† ${person.deathPlace}` : null].filter(Boolean).join(" · ") || "—"}</ItemMeta>
              </ListItem>
            );
          })}
        </List>
      )}
    </Card>
  );
}

function RelationForm({ people, relations, onCreated }: { people: Person[]; relations: Relation[]; onCreated: (relation: Relation) => void }) {
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
    <Card as="form" onSubmit={handleSubmit}>
      <CardTitle>Nowa relacja</CardTitle>
      <CardHint>Zapis do Firestore → relations</CardHint>

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
        {people.length === 0 ? <Status>Najpierw dodaj osoby.</Status> : null}
        {status === "saved" ? <Status $ok>Zapisano</Status> : null}
        {status === "error" && error ? <Status>{error}</Status> : null}
      </Actions>
    </Card>
  );
}

function RelationList({ relations, peopleById }: { relations: Relation[]; peopleById: Map<string, Person> }) {
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

  return (
    <Card>
      <CardTitle>Lista relacji</CardTitle>
      <CardHint>{relations.length} rekordów</CardHint>
      {relations.length === 0 ? (
        <Empty>Brak relacji w kolekcji relations.</Empty>
      ) : (
        <List>
          {relations.map((relation) => (
            <ListItem key={relation.id}>
              <ItemTitle>
                <TypeBadge $type={relation.type}>{relation.type}</TypeBadge>
                {relation.root ? <RootBadge>root</RootBadge> : null}
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
  max-width: 1100px;
  margin: 0 auto 1.75rem;
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

const Section = styled.section`
  max-width: 1100px;
  margin: 0 auto 2rem;
`;

const SectionHeading = styled.h2`
  margin: 0 0 0.85rem;
  font-size: 1.2rem;
  font-weight: 500;
`;

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: 1.25rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
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

const Input = styled.input`
  ${inputStyles}
`;

const Select = styled.select`
  ${inputStyles}
`;

const Textarea = styled.textarea`
  ${inputStyles}
  resize: vertical;
  min-height: 6rem;
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

const ListItem = styled.li`
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--line);
  background: #fff;
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
