import type { Person } from "@/entities/person/types";

export function formatPartialDate(date: Person["birth"] | Person["death"]) {
  if (!date?.year) return null;
  if (date.day && date.month) return `${date.day}.${date.month}.${date.year}`;
  if (date.month) return `${date.month}.${date.year}`;
  return String(date.year);
}

export function personDatesOrId(person: Person) {
  const birth = formatPartialDate(person.birth);
  const death = formatPartialDate(person.death);
  if (!birth && !death) return { kind: "id" as const, text: person.id };
  return {
    kind: "dates" as const,
    text: [birth ? `* ${birth}` : null, death ? `† ${death}` : null].filter(Boolean).join(" · "),
  };
}

export function personName(person: Person) {
  return `${person.firstName} ${person.lastName}`.trim() || person.id;
}

export function personLabel(person: Person) {
  const hint = personDatesOrId(person);
  return `${personName(person)} — ${hint.text}`;
}

export function personSearchText(person: Person) {
  return [
    personName(person),
    personDatesOrId(person).text,
    person.id,
    person.birthPlace,
    person.deathPlace,
    person.birthSurname,
    ...(person.middleNames ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesPersonQuery(person: Person, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = personSearchText(person);
  return tokens.every((token) => haystack.includes(token));
}
