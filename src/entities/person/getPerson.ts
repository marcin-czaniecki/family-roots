import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { normalizePerson, type Person } from "./types";

export async function getPerson(id: string): Promise<Person> {
  const docSnap = await getDoc(doc(db, "people", id));
  return normalizePerson(docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
}
