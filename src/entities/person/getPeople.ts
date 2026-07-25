import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { normalizePerson, type Person } from "./types";

export async function getPeople(): Promise<Person[]> {
  const snapshot = await getDocs(query(collection(db, "people"), where("root", "!=", true)));
  return snapshot.docs.map((document) => normalizePerson(document.id, document.data() as Record<string, unknown>));
}
