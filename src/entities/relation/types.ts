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
