import { collection, getDocs } from "firebase/firestore";
import { createBrowserRouter, NavLink, Outlet } from "react-router";
import styled from "styled-components";
import { normalizePerson } from "@/entities/person/types";
import { normalizeRelation } from "@/entities/relation/types";
import { buildGenealogyGraph } from "@/features/genealogyLayout";
import { db } from "./firebase";
import { Dashboard } from "./views/Dashboard";
import { Home } from "./views/Home";

function MainLayout() {
  return (
    <AppShell>
      <TopBar>
        <NavContent>
          <BrandLink to="/" aria-label="Rafałowscy — drzewo rodzinne">
            <BrandName>Rafałowscy</BrandName>
            <BrandSubtitle>Drzewo rodzinne</BrandSubtitle>
          </BrandLink>
          <Navigation aria-label="Główna nawigacja">
            <NavigationLink to="/" end>
              Drzewo
            </NavigationLink>
            <NavigationLink to="/dashboard">Dashboard</NavigationLink>
          </Navigation>
        </NavContent>
      </TopBar>
      <MainContent>
        <Outlet />
      </MainContent>
    </AppShell>
  );
}

const AppShell = styled.div`
  min-height: 100vh;
  background: #f3efe8;
  color: #1c2a22;
`;

const TopBar = styled.header`
  position: fixed;
  z-index: 100;
  top: 0;
  right: 0;
  left: 0;
  height: 4rem;
  border-bottom: 1px solid #c5b8a4;
  background: rgba(247, 244, 239, 0.96);
  box-shadow: 0 2px 12px rgba(28, 42, 34, 0.08);
  backdrop-filter: blur(10px);
`;

const NavContent = styled.div`
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 1.5rem;
`;

const BrandLink = styled(NavLink)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  border-left: 3px solid #6b4f3a;
  color: #1c2a22;
  padding-left: 0.75rem;
  text-decoration: none;

  &:focus-visible {
    outline: 2px solid #3d5a4c;
    outline-offset: 4px;
  }
`;

const BrandName = styled.span`
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.1;
`;

const BrandSubtitle = styled.span`
  margin-top: 0.15rem;
  color: #5c6b62;
  font-size: 0.7rem;
  line-height: 1;
`;

const Navigation = styled.nav`
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
`;

const NavigationLink = styled(NavLink)`
  position: relative;
  display: flex;
  align-items: center;
  min-width: 5.5rem;
  justify-content: center;
  color: #5c6b62;
  padding: 0 1rem;
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    color 0.15s ease,
    background 0.15s ease;

  &::after {
    content: "";
    position: absolute;
    right: 1rem;
    bottom: 0;
    left: 1rem;
    height: 3px;
    background: transparent;
  }

  &:hover {
    background: #eee8de;
    color: #1c2a22;
  }

  &:focus-visible {
    outline: 2px solid #3d5a4c;
    outline-offset: -4px;
  }

  &.active {
    color: #1c2a22;
  }

  &.active::after {
    background: #3d5a4c;
  }

  @media (max-width: 520px) {
    min-width: auto;
    padding: 0 0.7rem;

    &::after {
      right: 0.7rem;
      left: 0.7rem;
    }
  }
`;

const MainContent = styled.main`
  min-height: 100vh;
  box-sizing: border-box;
  padding-top: 4rem;
`;

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
          const relations = snapshotRelations.docs.flatMap((document) => {
            const relation = normalizeRelation(document.id, document.data() as Record<string, unknown>);
            return relation ? [relation] : [];
          });
          const people = snapshotPeople.docs.map((doc) => normalizePerson(doc.id, doc.data() as Record<string, unknown>));
          return { ...(await buildGenealogyGraph(relations, new Map(people.map((person) => [person.id, person])))), relations, people };
        },
        HydrateFallback: () => <p>Loading…</p>,
      },
      {
        path: "/dashboard",
        loader: async () => {
          const [snapshotPeople, snapshotRelations] = await Promise.all([getDocs(collection(db, "people")), getDocs(collection(db, "relations"))]);
          const relations = snapshotRelations.docs.flatMap((document) => {
            const relation = normalizeRelation(document.id, document.data() as Record<string, unknown>);
            return relation ? [relation] : [];
          });
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
