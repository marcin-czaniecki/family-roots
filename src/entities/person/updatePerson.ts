import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/firebase";
import type { Person } from "./types";

export async function updatePerson(id: string, person: Omit<Person, "id">): Promise<void> {
  await updateDoc(doc(db, "people", id), {
    ...person,
    updateAt: serverTimestamp(),
  });
}
