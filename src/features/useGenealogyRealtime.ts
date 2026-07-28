import type { Edge, Node } from "@xyflow/react";
import { collection, onSnapshot, onSnapshotsInSync } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { normalizePerson, type Person } from "@/entities/person/types";
import { normalizeRelation, type Relation, type TreeLayoutPreset } from "@/entities/relation/types";
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

function sameDate(first: Person["birth"], second: Person["birth"]) {
  if (first === second) return true;
  return Boolean(first && second && first.day === second.day && first.month === second.month && first.year === second.year);
}

function sameNames(first: string[] | null | undefined, second: string[] | null | undefined) {
  const left = first ?? [];
  const right = second ?? [];
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function samePerson(first: Person, second: Person) {
  return (
    first.id === second.id &&
    first.biography === second.biography &&
    first.firstName === second.firstName &&
    first.lastName === second.lastName &&
    sameDate(first.birth, second.birth) &&
    first.birthPlace === second.birthPlace &&
    first.birthSurname === second.birthSurname &&
    sameDate(first.death, second.death) &&
    first.deathPlace === second.deathPlace &&
    first.father?.id === second.father?.id &&
    first.mother?.id === second.mother?.id &&
    sameNames(first.middleNames, second.middleNames) &&
    first.photoUrl === second.photoUrl &&
    first.sex === second.sex
  );
}

function sameRelation(first: Relation, second: Relation) {
  if (
    first.id !== second.id ||
    first.type !== second.type ||
    first.first.id !== second.first.id ||
    first.second?.id !== second.second?.id ||
    first.root !== second.root ||
    first.color !== second.color ||
    first.layoutPreset !== second.layoutPreset
  ) {
    return false;
  }

  if (first.type === "partner" || second.type === "partner") return first.type === second.type;
  return first.person.id === second.person.id && first.parentship?.id === second.parentship?.id;
}

function sameEntitySet<T extends { id: string }>(first: T[], second: T[], isEqual: (left: T, right: T) => boolean) {
  if (first.length !== second.length) return false;
  const firstById = new Map(first.map((entity) => [entity.id, entity]));
  return second.every((entity) => {
    const previous = firstById.get(entity.id);
    return previous ? isEqual(previous, entity) : false;
  });
}

function sameSource(first: GenealogySource, second: GenealogySource) {
  return sameEntitySet(first.people, second.people, samePerson) && sameEntitySet(first.relations, second.relations, sameRelation);
}

export function useGenealogyRealtime(initialSource: GenealogySource, initialGraph: GenealogyGraph, layoutPreset: TreeLayoutPreset) {
  const [source, setSource] = useState<GenealogySource>(() => ({
    people: initialSource.people,
    relations: initialSource.relations.flatMap((relation) => {
      const normalized = normalizeRelation(relation.id, relation as unknown as Record<string, unknown>);
      return normalized ? [normalized] : [];
    }),
  }));
  const [graph, setGraph] = useState(initialGraph);
  const skipInitialGraphBuild = useRef(true);

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

      const nextSource = { people: bufferedPeople, relations: bufferedRelations };
      const previousSource = { people: publishedPeople, relations: publishedRelations };
      publishedPeople = bufferedPeople;
      publishedRelations = bufferedRelations;
      if (sameSource(previousSource, nextSource)) return;

      setSource(nextSource);
    });

    return () => {
      active = false;
      unsubscribeSync();
      unsubscribePeople();
      unsubscribeRelations();
    };
  }, [initialSource.people, initialSource.relations]);

  useEffect(() => {
    if (skipInitialGraphBuild.current) {
      skipInitialGraphBuild.current = false;
      return;
    }

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

    void buildGenealogyGraph(source.relations, peopleById, layoutPreset)
      .then((nextGraph) => {
        if (active) setGraph(nextGraph);
      })
      .catch((error) => {
        if (active) console.error("Nie udało się przebudować drzewa ze snapshotów Firestore.", error);
      });

    return () => {
      active = false;
    };
  }, [layoutPreset, source]);

  return {
    graph,
    people: source.people,
    relations: source.relations,
  };
}
