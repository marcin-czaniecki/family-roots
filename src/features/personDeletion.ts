import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import type { Person } from "@/entities/person/types";
import type { Relation } from "@/entities/relation/types";
import { db } from "@/firebase";

type PersonDeletionPlan = {
  clearedParentLinks: Person[];
  deletedRelationIds: Set<string>;
  deletesRootRelation: boolean;
  updatedRelations: Map<string, Relation>;
};

function refId(value: { id?: string } | null | undefined) {
  return value?.id ?? null;
}

function buildPersonDeletionPlan(person: Person, people: Person[], relations: Relation[]): PersonDeletionPlan {
  const deletedPartnerIds = new Set(
    relations
      .filter((relation) => relation.type === "partner" && (refId(relation.first) === person.id || refId(relation.second) === person.id))
      .map((relation) => relation.id),
  );
  const deletedRelationIds = new Set<string>();
  const updatedRelations = new Map<string, Relation>();

  for (const relation of relations) {
    if (relation.type === "partner") {
      if (deletedPartnerIds.has(relation.id)) deletedRelationIds.add(relation.id);
      continue;
    }

    if (refId(relation.person) === person.id) {
      deletedRelationIds.add(relation.id);
      continue;
    }

    const firstDeleted = refId(relation.first) === person.id;
    const secondDeleted = refId(relation.second) === person.id;
    const parentshipDeleted = deletedPartnerIds.has(refId(relation.parentship) ?? "");

    if (firstDeleted) {
      const remainingParent = relation.second && refId(relation.second) !== person.id ? relation.second : null;
      if (!remainingParent) {
        deletedRelationIds.add(relation.id);
        continue;
      }
      updatedRelations.set(relation.id, {
        ...relation,
        first: remainingParent,
        second: null,
        parentship: null,
      });
    } else if (secondDeleted || parentshipDeleted) {
      updatedRelations.set(relation.id, {
        ...relation,
        ...(secondDeleted ? { second: null } : {}),
        parentship: null,
      });
    }
  }

  return {
    clearedParentLinks: people.filter(
      (otherPerson) => otherPerson.id !== person.id && (otherPerson.father?.id === person.id || otherPerson.mother?.id === person.id),
    ),
    deletedRelationIds,
    deletesRootRelation: relations.some((relation) => relation.root && deletedRelationIds.has(relation.id)),
    updatedRelations,
  };
}

export function getPersonDeletionImpact(person: Person, people: Person[], relations: Relation[]) {
  const plan = buildPersonDeletionPlan(person, people, relations);
  return {
    parentLinksToClear: plan.clearedParentLinks.length,
    relationsToDelete: plan.deletedRelationIds.size,
    relationsToUpdate: plan.updatedRelations.size,
    deletesRootRelation: plan.deletesRootRelation,
  };
}

export async function deletePersonWithRelations(person: Person, people: Person[], relations: Relation[]) {
  const plan = buildPersonDeletionPlan(person, people, relations);
  const batch = writeBatch(db);

  for (const relationId of plan.deletedRelationIds) {
    batch.delete(doc(db, "relations", relationId));
  }
  for (const relation of plan.updatedRelations.values()) {
    if (relation.type !== "parent") continue;
    batch.update(doc(db, "relations", relation.id), {
      first: relation.first,
      second: relation.second ?? null,
      parentship: relation.parentship ?? null,
    });
  }
  for (const otherPerson of plan.clearedParentLinks) {
    batch.update(doc(db, "people", otherPerson.id), {
      ...(otherPerson.father?.id === person.id ? { father: null } : {}),
      ...(otherPerson.mother?.id === person.id ? { mother: null } : {}),
      updatedAt: serverTimestamp(),
    });
  }
  batch.delete(doc(db, "people", person.id));
  await batch.commit();

  return {
    people: people
      .filter((candidate) => candidate.id !== person.id)
      .map((candidate) => ({
        ...candidate,
        ...(candidate.father?.id === person.id ? { father: null } : {}),
        ...(candidate.mother?.id === person.id ? { mother: null } : {}),
      })),
    relations: relations.filter((relation) => !plan.deletedRelationIds.has(relation.id)).map((relation) => plan.updatedRelations.get(relation.id) ?? relation),
  };
}
