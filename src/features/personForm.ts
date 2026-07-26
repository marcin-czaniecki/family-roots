import type { Person } from "@/entities/person/types";

export type PersonFormValues = {
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

export function emptyPersonForm(): PersonFormValues {
  return {
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
  };
}

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

export function validatePersonForm(form: PersonFormValues): string | null {
  if (!form.firstName.trim() || !form.lastName.trim()) return "Imię i nazwisko są wymagane.";
  return (
    validatePartialDate(form.birthDay, form.birthMonth, form.birthYear, "Data urodzenia") ??
    validatePartialDate(form.deathDay, form.deathMonth, form.deathYear, "Data śmierci")
  );
}

export function personToForm(person: Person): PersonFormValues {
  return {
    biography: person.biography ?? "",
    firstName: person.firstName,
    lastName: person.lastName,
    middleNames: (person.middleNames ?? []).join(", "),
    birthDay: person.birth?.day ? String(person.birth.day) : "",
    birthMonth: person.birth?.month ? String(person.birth.month) : "",
    birthYear: person.birth?.year ? String(person.birth.year) : "",
    birthPlace: person.birthPlace ?? "",
    birthSurname: person.birthSurname ?? "",
    deathDay: person.death?.day ? String(person.death.day) : "",
    deathMonth: person.death?.month ? String(person.death.month) : "",
    deathYear: person.death?.year ? String(person.death.year) : "",
    deathPlace: person.deathPlace ?? "",
    photoUrl: person.photoUrl ?? "",
    sex: person.sex ? "male" : "female",
  };
}

export function personFormPayload(form: PersonFormValues) {
  return {
    biography: form.biography.trim() || null,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    middleNames: form.middleNames
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    birth: buildPartialDate(form.birthDay, form.birthMonth, form.birthYear),
    birthPlace: form.birthPlace.trim() || null,
    birthSurname: form.birthSurname.trim() || null,
    death: buildPartialDate(form.deathDay, form.deathMonth, form.deathYear),
    deathPlace: form.deathPlace.trim() || null,
    photoUrl: form.photoUrl.trim() || null,
    sex: form.sex === "male",
  };
}
