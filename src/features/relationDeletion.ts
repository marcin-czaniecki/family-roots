import { doc, writeBatch } from "firebase/firestore";
import type { Relation } from "@/entities/relation/types";
import { db } from "@/firebase";

export function getRelationDeletionImpact(relation: Relation, relations: Relation[]) {
  const dependentParentIds =
    relation.type === "partner"
      ? relations.filter((candidate) => candidate.type === "parent" && candidate.parentship?.id === relation.id).map((candidate) => candidate.id)
      : [];

  return {
    dependentParentIds,
    parentshipsToClear: dependentParentIds.length,
    deletesRootRelation: relation.root,
  };
}

export async function deleteRelationWithDependents(relation: Relation, relations: Relation[]) {
  const impact = getRelationDeletionImpact(relation, relations);
  const batch = writeBatch(db);

  for (const relationId of impact.dependentParentIds) {
    batch.update(doc(db, "relations", relationId), { parentship: null });
  }
  batch.delete(doc(db, "relations", relation.id));
  await batch.commit();

  const dependentIds = new Set(impact.dependentParentIds);
  return {
    relations: relations
      .filter((candidate) => candidate.id !== relation.id)
      .map((candidate) => (candidate.type === "parent" && dependentIds.has(candidate.id) ? { ...candidate, parentship: null } : candidate)),
  };
}
