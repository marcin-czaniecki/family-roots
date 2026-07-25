import type { ParentRelation, PartnerRelation, Relation } from "./types";

export function isPartner(r: Relation): r is PartnerRelation {
  return r.type === "partner";
}

export function isParent(r: Relation): r is ParentRelation {
  return r.type === "parent";
}

export function hasParentship(r: ParentRelation): boolean {
  return Boolean(r.parentship?.id);
}

export function childrenOf(relations: Relation[], partnerRel: PartnerRelation): ParentRelation[] {
  return relations.filter((r): r is ParentRelation => {
    if (!isParent(r)) return false;
    if (r.parentship?.id === partnerRel.id) return true;
    if (!hasParentship(r)) {
      const parents = new Set([partnerRel.first.id, partnerRel.second?.id].filter(Boolean) as string[]);
      const linked = [r.first?.id, r.second?.id].filter(Boolean) as string[];
      return linked.length > 0 && linked.every((id) => parents.has(id));
    }
    return false;
  });
}

export function partnersOf(relations: Relation[], personId: string, excludeRelationId?: string): PartnerRelation[] {
  return relations.filter((r): r is PartnerRelation => isPartner(r) && r.id !== excludeRelationId && (r.first.id === personId || r.second?.id === personId));
}

export function partnerOf(relations: Relation[], personId: string, excludeRelationId?: string) {
  return partnersOf(relations, personId, excludeRelationId)[0];
}

/** Linked only to left parent → left, only to right → right, couple's child → center. */
export function sideOfKid(child: ParentRelation, leftParentId: string, rightParentId: string | null): "left" | "center" | "right" {
  if (hasParentship(child)) return "center";
  const linked = [child.first?.id, child.second?.id].filter(Boolean) as string[];
  const linksLeft = linked.includes(leftParentId);
  const linksRight = rightParentId ? linked.includes(rightParentId) : false;
  if (linksLeft && !linksRight) return "left";
  if (linksRight && !linksLeft) return "right";
  return "center";
}
