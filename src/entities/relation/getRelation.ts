import { collection, type DocumentReference, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import type { Relation } from "./types";

export async function getRelation(id: DocumentReference): Promise<Relation | null> {
  const relations = await getDocs(query(collection(db, "relations"), where("active", "==", true), where("first", "==", id)));
  if (relations.empty) {
    const secondRelations = await getDocs(query(collection(db, "relations"), where("active", "==", true), where("second", "==", id)));
    const doc = secondRelations.docs.at(0);
    return doc ? ({ id: doc.id, ...doc.data() } as Relation) : null;
  }
  const doc = relations.docs.at(0);
  return doc ? ({ id: doc.id, ...doc.data() } as Relation) : null;
}
