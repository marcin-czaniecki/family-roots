import { collection, getDocs } from "firebase/firestore";
import { createBrowserRouter } from "react-router";
import { db } from "./firebase";
import { Home } from "./views/Home";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
    loader: async () => {
      const relations = await getDocs(collection(db, "relations"));
      return relations.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },
    HydrateFallback: () => <p>Loading…</p>,
  },
]);

export default router;
