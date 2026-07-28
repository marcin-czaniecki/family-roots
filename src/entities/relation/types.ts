import type { DocumentReference } from "firebase/firestore";

export type TreeLayoutPreset = "compact" | "balanced" | "spacious";

export type PartnerRelation = {
  color?: string | null;
  layoutPreset?: TreeLayoutPreset | null;
  id: string;
  first: DocumentReference;
  second?: DocumentReference | null;
  root: boolean;
  type: "partner";
};

export type ParentRelation = {
  color?: string | null;
  layoutPreset?: TreeLayoutPreset | null;
  id: string;
  first: DocumentReference;
  second?: DocumentReference | null;
  root: boolean;
  parentship?: DocumentReference | null;
  person: DocumentReference;
  type: "parent";
};

export type Relation = PartnerRelation | ParentRelation;

function asRelationColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

function asTreeLayoutPreset(value: unknown): TreeLayoutPreset | null {
  return value === "compact" || value === "balanced" || value === "spacious" ? value : null;
}

function asDocumentReference(value: unknown): DocumentReference | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return null;
  return value as DocumentReference;
}

export function normalizeRelation(id: string, data: Record<string, unknown>): Relation | null {
  const first = asDocumentReference(data.first);
  if (!first) return null;

  const second = asDocumentReference(data.second);
  const root = data.root === true;
  const color = asRelationColor(data.color);
  const layoutPreset = asTreeLayoutPreset(data.layoutPreset);

  if (data.type === "partner") {
    return { color, id, first, layoutPreset, second, root, type: "partner" };
  }

  if (data.type === "parent") {
    const person = asDocumentReference(data.person);
    if (!person) return null;
    return {
      color,
      id,
      first,
      layoutPreset,
      second,
      root,
      parentship: asDocumentReference(data.parentship),
      person,
      type: "parent",
    };
  }

  return null;
}
