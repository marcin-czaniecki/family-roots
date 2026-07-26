import type { DocumentReference } from "firebase/firestore";

export type PartnerRelation = {
  id: string;
  first: DocumentReference;
  second?: DocumentReference | null;
  root: boolean;
  type: "partner";
};

export type ParentRelation = {
  id: string;
  first: DocumentReference;
  second?: DocumentReference | null;
  root: boolean;
  parentship?: DocumentReference | null;
  person: DocumentReference;
  type: "parent";
};

export type Relation = PartnerRelation | ParentRelation;

function asDocumentReference(value: unknown): DocumentReference | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return null;
  return value as DocumentReference;
}

export function normalizeRelation(id: string, data: Record<string, unknown>): Relation | null {
  const first = asDocumentReference(data.first);
  if (!first) return null;

  const second = asDocumentReference(data.second);
  const root = data.root === true;

  if (data.type === "partner") {
    return { id, first, second, root, type: "partner" };
  }

  if (data.type === "parent") {
    const person = asDocumentReference(data.person);
    if (!person) return null;
    return {
      id,
      first,
      second,
      root,
      parentship: asDocumentReference(data.parentship),
      person,
      type: "parent",
    };
  }

  return null;
}
