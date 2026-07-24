import { collection, getDocs } from "firebase/firestore";
import { createBrowserRouter } from "react-router";
import type { Relation } from "@/entities/relation/types";
import { buildGenealogyGraph } from "@/features/genealogyLayout";
import { db } from "./firebase";
import { Home } from "./views/Home";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
    loader: async () => {
      const snapshot = await getDocs(collection(db, "relations"));
      const relations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Relation[];
      return buildGenealogyGraph(relations);
    },
    HydrateFallback: () => <p>Loading…</p>,
  },
]);

export default router;
