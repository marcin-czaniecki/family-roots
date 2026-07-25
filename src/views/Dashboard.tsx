import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import styled from "styled-components";
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

const emptyForm = (): PersonFormValues => ({
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

function toFirestorePayload(form: PersonFormValues) {
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

export function Dashboard() {
  const { people } = useLoaderData<{ relations: Relation[]; people: Person[] }>();

  return (
    <Page>
      <Header>
        <Title>Panel osób</Title>
        <Subtitle>Dodawanie i przegląd rekordów z kolekcji people</Subtitle>
      </Header>
      <Layout>
        <PersonForm />
        <PersonList people={people} />
      </Layout>
    </Page>
  );
}

function PersonForm() {
  const revalidator = useRevalidator();
  const [form, setForm] = useState<PersonFormValues>(emptyForm);
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
      await addDoc(collection(db, "people"), toFirestorePayload(form));
      setForm(emptyForm());
      setStatus("saved");
      revalidator.revalidate();
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
          <Input
            id="middleNames"
            placeholder="oddzielone przecinkami"
            value={form.middleNames}
            onChange={(e) => update("middleNames", e.target.value)}
          />
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
  return (
    <Card>
      <CardTitle>Lista osób</CardTitle>
      <CardHint>{people.length} rekordów</CardHint>
      {people.length === 0 ? (
        <Empty>Brak osób w kolekcji people.</Empty>
      ) : (
        <List>
          {people.map((person) => (
            <ListItem key={person.id}>
              <PersonName>
                {person.firstName} {person.lastName}
              </PersonName>
              <PersonMeta>
                {person.birth?.year ? `* ${person.birth.year}` : "—"}
                {person.birthPlace ? ` · ${person.birthPlace}` : ""}
              </PersonMeta>
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

const Layout = styled.div`
  max-width: 1100px;
  margin: 0 auto;
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

const ListItem = styled.li`
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--line);
  background: #fff;
`;

const PersonName = styled.div`
  font-size: 0.95rem;
`;

const PersonMeta = styled.div`
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--muted);
`;

const Empty = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
`;
