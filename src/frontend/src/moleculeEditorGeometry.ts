export type EditorPoint = { x: number; y: number };

export const EDITOR_DIRECTIONS = [
  { x: 0, y: -1, key: "up", label: "above" },
  { x: 1, y: 0, key: "right", label: "to the right" },
  { x: 0, y: 1, key: "down", label: "below" },
  { x: -1, y: 0, key: "left", label: "to the left" },
] as const;

export type EditorDirection = (typeof EDITOR_DIRECTIONS)[number];
export type PositionedAtom = EditorPoint & { id: string };
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
