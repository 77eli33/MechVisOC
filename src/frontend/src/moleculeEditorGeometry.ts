export type EditorPoint = { x: number; y: number };

export const EDITOR_DIRECTIONS = [
  { x: 0, y: -1, key: "up", label: "above" },
  { x: 1, y: 0, key: "right", label: "to the right" },
  { x: 0, y: 1, key: "down", label: "below" },
  { x: -1, y: 0, key: "left", label: "to the left" },
] as const;

export type EditorDirection = (typeof EDITOR_DIRECTIONS)[number];
export type PositionedAtom = EditorPoint & { id: string };
export type EditorBond = { from: string; to: string };
export type EditorSlot = EditorPoint & {
  key: string;
  kind: "slot";
  parentId: string;
  direction: EditorDirection;
};
export type NavigationTarget = EditorPoint & { key: string; kind: "atom" | "slot" };

export function freeSlots(parent: PositionedAtom, atoms: PositionedAtom[]): EditorSlot[] {
  return EDITOR_DIRECTIONS.flatMap((direction) => {
    const x = parent.x + direction.x;
    const y = parent.y + direction.y;
    if (atoms.some((atom) => atom.x === x && atom.y === y)) return [];
    return [{
      x,
      y,
      key: `slot:${parent.id}:${direction.key}`,
      kind: "slot" as const,
      parentId: parent.id,
      direction,
    }];
  });
}

export function nextNavigationTarget(
  current: NavigationTarget,
  targets: NavigationTarget[],
  direction: EditorPoint,
): NavigationTarget | null {
  const candidates = targets.flatMap((target) => {
    if (target.key === current.key) return [];
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const forward = dx * direction.x + dy * direction.y;
    if (forward <= 0) return [];
    const perpendicular = Math.abs(dx * direction.y - dy * direction.x);
    const distance = Math.hypot(dx, dy);
    return [{ target, angle: perpendicular / distance, distance }];
  });

  candidates.sort((a, b) => a.angle - b.angle || a.distance - b.distance || a.target.key.localeCompare(b.target.key));
  return candidates[0]?.target ?? null;
}

export function formatFormalCharge(charge: number): string {
  if (charge === 0) return "";
  const magnitude = Math.abs(charge);
  return `${magnitude === 1 ? "" : magnitude}${charge > 0 ? "+" : "−"}`;
}

export function removeAtomAndDisconnectedBranches<
  Atom extends PositionedAtom,
  Bond extends EditorBond,
>(atomId: string, atoms: Atom[], bonds: Bond[]): { atoms: Atom[]; bonds: Bond[] } {
  const remainingAtoms = atoms.filter((atom) => atom.id !== atomId);
  if (remainingAtoms.length === atoms.length) return { atoms, bonds };
  if (remainingAtoms.length === 0) return { atoms: [], bonds: [] };

  const remainingIds = new Set(remainingAtoms.map((atom) => atom.id));
  const remainingBonds = bonds.filter(
    (bond) => remainingIds.has(bond.from) && remainingIds.has(bond.to),
  );
  const neighbors = new Map(remainingAtoms.map((atom) => [atom.id, new Set<string>()]));
  remainingBonds.forEach((bond) => {
    neighbors.get(bond.from)?.add(bond.to);
    neighbors.get(bond.to)?.add(bond.from);
  });

  // Atom order follows editor insertion order, so the earliest survivor is
  // the established part of the structure and cut-off branches are discarded.
  const connectedIds = new Set([remainingAtoms[0].id]);
  const pendingIds = [remainingAtoms[0].id];
  while (pendingIds.length > 0) {
    const currentId = pendingIds.pop()!;
    neighbors.get(currentId)?.forEach((neighborId) => {
      if (connectedIds.has(neighborId)) return;
      connectedIds.add(neighborId);
      pendingIds.push(neighborId);
    });
  }

  return {
    atoms: remainingAtoms.filter((atom) => connectedIds.has(atom.id)),
    bonds: remainingBonds.filter(
      (bond) => connectedIds.has(bond.from) && connectedIds.has(bond.to),
    ),
  };
}
