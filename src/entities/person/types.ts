import type { DocumentReference, Timestamp } from "firebase/firestore";

export interface Person {
  id: string;
  biography: string | null;
  firstName: string;
  lastName: string;
  birth: Record<"day" | "month" | "year", number> | null;
  birthPlace: string | null;
  birthSurname: string | null;
  createdAt: Timestamp;
  death: Record<"day" | "month" | "year", number> | null;
  deathPlace: string | null;
  father: DocumentReference | null;
  mother: DocumentReference | null;
  middleNames?: string[] | null;
  photoUrl: string | null;
  sex: boolean;
}

export function normalizePerson(id: string, data: Record<string, unknown>): Person {
  return {
    ...(data as Omit<Person, "id" | "middleNames">),
    id,
    middleNames: Array.isArray(data.middleNames) ? (data.middleNames as string[]) : [],
  };
}
