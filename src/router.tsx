import { collection, getDocs } from "firebase/firestore";
import { createBrowserRouter, Link, Outlet } from "react-router";
import type { Relation } from "@/entities/relation/types";
import { buildGenealogyGraph } from "@/features/genealogyLayout";
import type { Person } from "./entities/person/types";
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
          const snapshot = await getDocs(collection(db, "relations"));
          const relations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Relation[];
          return buildGenealogyGraph(relations);
        },
        HydrateFallback: () => <p>Loading…</p>,
      },
      {
        path: "/dashboard",
        loader: async () => {
          const snapshotPeople = await getDocs(collection(db, "people"));
          const snapshotRelations = await getDocs(collection(db, "relations"));
          const relations = snapshotRelations.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Relation[];
          const people = snapshotPeople.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Person[];
          return { relations, people };
        },
        HydrateFallback: () => <p>Loading…</p>,
        Component: Dashboard,
      },
    ],
  },
]);

export default router;
