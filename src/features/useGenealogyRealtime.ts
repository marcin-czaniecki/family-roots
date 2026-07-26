import type { Edge, Node } from "@xyflow/react";
import { collection, onSnapshot, onSnapshotsInSync } from "firebase/firestore";
import { useEffect, useState } from "react";
import { normalizePerson, type Person } from "@/entities/person/types";
import { normalizeRelation, type Relation } from "@/entities/relation/types";
import { db } from "@/firebase";
import { buildGenealogyGraph } from "./genealogyLayout";

type GenealogySource = {
  people: Person[];
  relations: Relation[];
};

type GenealogyGraph = {
  nodes: Node[];
  edges: Edge[];
};

export function useGenealogyRealtime(initialSource: GenealogySource, initialGraph: GenealogyGraph) {
  const [source, setSource] = useState<GenealogySource>(() => ({
    people: initialSource.people,
    relations: initialSource.relations.flatMap((relation) => {
      const normalized = normalizeRelation(relation.id, relation as unknown as Record<string, unknown>);
      return normalized ? [normalized] : [];
    }),
  }));
  const [graph, setGraph] = useState(initialGraph);

  useEffect(() => {
    let active = true;
    let peopleReady = false;
    let relationsReady = false;
    let bufferedPeople = initialSource.people;
    let bufferedRelations = initialSource.relations;
    let publishedPeople = initialSource.people;
    let publishedRelations = initialSource.relations;

    const unsubscribePeople = onSnapshot(
      collection(db, "people"),
      (snapshot) => {
        bufferedPeople = snapshot.docs.map((document) => normalizePerson(document.id, document.data() as Record<string, unknown>));
        peopleReady = true;
      },
      (error) => console.error("Listener people został przerwany.", error),
    );
    const unsubscribeRelations = onSnapshot(
      collection(db, "relations"),
      (snapshot) => {
        bufferedRelations = snapshot.docs.flatMap((document) => {
          const relation = normalizeRelation(document.id, document.data() as Record<string, unknown>);
          if (relation) return [relation];
          console.warn(`Pominięto nieprawidłową relację Firestore: ${document.id}.`);
          return [];
        });
        relationsReady = true;
      },
      (error) => console.error("Listener relations został przerwany.", error),
    );
    const unsubscribeSync = onSnapshotsInSync(db, () => {
      if (!active || !peopleReady || !relationsReady) return;
      if (bufferedPeople === publishedPeople && bufferedRelations === publishedRelations) return;

      publishedPeople = bufferedPeople;
      publishedRelations = bufferedRelations;
      setSource({
        people: bufferedPeople,
        relations: bufferedRelations,
      });
    });

    return () => {
      active = false;
      unsubscribeSync();
      unsubscribePeople();
      unsubscribeRelations();
    };
  }, [initialSource.people, initialSource.relations]);

  useEffect(() => {
    let active = true;
    const peopleById = new Map(source.people.map((person) => [person.id, person]));
    const referencedPersonIds = new Set<string>();

    for (const relation of source.relations) {
      referencedPersonIds.add(relation.first.id);
      if (relation.second?.id) referencedPersonIds.add(relation.second.id);
      if (relation.type === "parent") referencedPersonIds.add(relation.person.id);
    }

    const missingPersonIds = [...referencedPersonIds].filter((personId) => !peopleById.has(personId));
    if (missingPersonIds.length > 0) {
      console.error(`Nie można przebudować drzewa. Brak osób: ${missingPersonIds.join(", ")}.`);
      return;
    }

    void buildGenealogyGraph(source.relations, peopleById)
      .then((nextGraph) => {
        if (active) setGraph(nextGraph);
      })
      .catch((error) => {
        if (active) console.error("Nie udało się przebudować drzewa ze snapshotów Firestore.", error);
      });

    return () => {
      active = false;
    };
  }, [source]);

  return {
    graph,
    people: source.people,
    relations: source.relations,
  };
}
