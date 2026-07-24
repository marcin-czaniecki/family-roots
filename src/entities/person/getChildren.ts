import { collection, type DocumentReference, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import type { Person } from "./types";

export async function getChildren(reference: DocumentReference): Promise<Person[]> {
  const snapshot = await getDocs(query(collection(db, "people"), where("father", "==", reference)));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Person);
}
