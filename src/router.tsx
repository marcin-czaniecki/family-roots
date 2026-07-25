import { collection, getDocs } from "firebase/firestore";
import { createBrowserRouter, Link, Outlet } from "react-router";
import { normalizePerson } from "@/entities/person/types";
import type { Relation } from "@/entities/relation/types";
import { buildGenealogyGraph } from "@/features/genealogyLayout";
import { db } from "./firebase";
import { Dashboard } from "./views/Dashboard";
import { Home } from "./views/Home";

function MainLayout() {
  return (
    <>
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, display: "flex", gap: "10px", zIndex: 100 }}>
        <Link to="/">Home</Link>
        <Link to="/dashboard">Dashboard</Link>
      </nav>
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MainLayout,
    children: [
      {
        path: "/",
        Component: Home,
        loader: async () => {
          const [snapshotRelations, snapshotPeople] = await Promise.all([getDocs(collection(db, "relations")), getDocs(collection(db, "people"))]);
          const relations = snapshotRelations.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Relation[];
          const people = snapshotPeople.docs.map((doc) => normalizePerson(doc.id, doc.data() as Record<string, unknown>));
          return { ...(await buildGenealogyGraph(relations)), relations, people };
        },
        HydrateFallback: () => <p>Loading…</p>,
      },
      {
        path: "/dashboard",
        loader: async () => {
          const snapshotPeople = await getDocs(collection(db, "people"));
          const snapshotRelations = await getDocs(collection(db, "relations"));
          const relations = snapshotRelations.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Relation[];
          const people = snapshotPeople.docs.map((doc) => normalizePerson(doc.id, doc.data() as Record<string, unknown>));
          return { relations, people };
        },
        HydrateFallback: () => <p>Loading…</p>,
        Component: Dashboard,
      },
    ],
  },
]);

export default router;
