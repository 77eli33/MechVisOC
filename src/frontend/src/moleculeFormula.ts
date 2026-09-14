export type FormulaPart = { symbol: string; count: number };
export type FormulaAtom = { symbol: string; implicitHydrogens: number };

export function formulaFromAtoms(atoms: FormulaAtom[]): FormulaPart[] {
  const counts = new Map<string, number>();
  atoms.forEach((atom) => counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1));

  const implicitHydrogens = atoms.reduce((total, atom) => total + atom.implicitHydrogens, 0);
  if (implicitHydrogens > 0) counts.set("H", (counts.get("H") ?? 0) + implicitHydrogens);

  const parts = Array.from(counts, ([symbol, count]) => ({ symbol, count }));
  if (!counts.has("C")) return parts;

  // Keep the conventional carbon/hydrogen prefix while preserving the
  // editor's insertion order for all remaining elements.
  return [
    ...parts.filter(({ symbol }) => symbol === "C"),
    ...parts.filter(({ symbol }) => symbol === "H"),
    ...parts.filter(({ symbol }) => symbol !== "C" && symbol !== "H"),
  ];
}
