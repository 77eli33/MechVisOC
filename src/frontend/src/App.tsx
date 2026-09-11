import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShaderBackground from "./ShaderBackground";

type Side = "reactants" | "products";
type Atom = { id: string; symbol: string; x: number; y: number };
type Bond = { from: string; to: string };
type FormulaPart = { symbol: string; count: number };
type Molecule = {
  id: string;
  atoms: Atom[];
  bonds: Bond[];
  formula: FormulaPart[];
  charge: number;
};
type PendingAtom = { x: number; y: number; parentId?: string };
type ChargeMenuState = { side: Side; moleculeId: string; x: number; y: number };
type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

const directions = [
  { x: 0, y: -1, label: "above" },
  { x: 1, y: 0, label: "to the right" },
  { x: 0, y: 1, label: "below" },
  { x: -1, y: 0, label: "to the left" },
];

const seedMolecules: Record<Side, Molecule[]> = {
  reactants: [
    {
      id: "bromobutane",
      atoms: [],
      bonds: [],
      formula: [
        { symbol: "C", count: 4 },
        { symbol: "H", count: 12 },
        { symbol: "Br", count: 1 },
      ],
      charge: -1,
    },
    {
      id: "hydronium",
      atoms: [],
      bonds: [],
      formula: [
        { symbol: "H", count: 3 },
        { symbol: "O", count: 1 },
      ],
      charge: 1,
    },
  ],
  products: [],
};

const PlusIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const CloseIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M5 5l14 14M19 5L5 19" />
  </svg>
);

function formatFormulaLabel(formula: FormulaPart[]) {
  return formula.map(({ symbol, count }) => `${symbol}${count > 1 ? count : ""}`).join("");
}

function chargeLabel(charge: number) {
  if (charge === 0) return "neutral";
  return `${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "positive" : "negative"}`;
}

function normalizeSymbol(value: string) {
  const letters = value.replace(/[^a-z]/gi, "").slice(0, 2);
  return letters ? letters[0].toUpperCase() + letters.slice(1).toLowerCase() : "";
}

function moleculeFromSymbols(symbols: string[], charge = 0): Molecule {
  const atoms = symbols.map((symbol, index) => ({
    id: crypto.randomUUID(),
    symbol,
    x: index,
    y: 0,
  }));
  const counts = new Map<string, number>();
  symbols.forEach((symbol) => counts.set(symbol, (counts.get(symbol) ?? 0) + 1));
  return {
    id: crypto.randomUUID(),
    atoms,
    bonds: atoms.slice(1).map((atom, index) => ({ from: atoms[index].id, to: atom.id })),
    formula: Array.from(counts, ([symbol, count]) => ({ symbol, count })),
    charge,
  };
}

function Formula({ parts }: { parts: FormulaPart[] }) {
  return (
    <span className="formula">
      {parts.map(({ symbol, count }) => (
        <span key={symbol}>
          {symbol}
          {count > 1 && <sub>{count}</sub>}
        </span>
      ))}
    </span>
  );
}

function MoleculeChip({
  molecule,
  side,
  onOpenChargeMenu,
}: {
  molecule: Molecule;
  side: Side;
  onOpenChargeMenu: (menu: ChargeMenuState) => void;
}) {
  const label = `${formatFormulaLabel(molecule.formula)}, ${chargeLabel(molecule.charge)} charge`;
  return (
    <button
      className="molecule-chip"
      type="button"
      aria-label={`${label}. Right-click to edit charge.`}
      title="Right-click to edit charge"
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenChargeMenu({ side, moleculeId: molecule.id, x: event.clientX, y: event.clientY });
      }}
    >
      <span className="formula-bracket" aria-hidden="true" />
      <Formula parts={molecule.formula} />
      <span className="formula-bracket formula-bracket--right" aria-hidden="true" />
      {molecule.charge !== 0 && (
        <sup>
          {Math.abs(molecule.charge) > 1 ? Math.abs(molecule.charge) : ""}
          {molecule.charge > 0 ? "+" : "−"}
        </sup>
      )}
    </button>
  );
}

function MoleculePanel({
  side,
  title,
  molecules,
  onAdd,
  onOpenChargeMenu,
}: {
  side: Side;
  title: string;
  molecules: Molecule[];
  onAdd: () => void;
  onOpenChargeMenu: (menu: ChargeMenuState) => void;
}) {
  const countLabel = molecules.length === 0
    ? "No molecules yet"
    : `${molecules.length} ${molecules.length === 1 ? "molecule" : "molecules"}`;
  return (
    <section className="molecule-panel" aria-labelledby={`${side}-title`}>
      <header className="panel-heading">
        <h2 id={`${side}-title`}>{title}</h2>
        <span>{countLabel}</span>
      </header>
      <div className="molecule-row">
        {molecules.map((molecule) => (
          <MoleculeChip
            key={molecule.id}
            molecule={molecule}
            side={side}
            onOpenChargeMenu={onOpenChargeMenu}
          />
        ))}
        <button className="add-molecule" type="button" aria-label={`Add molecule to ${title}`} onClick={onAdd}>
          <PlusIcon />
        </button>
      </div>
    </section>
  );
}

function ChargeMenu({
  menu,
  molecule,
  onChange,
  onClose,
}: {
  menu: ChargeMenuState;
  molecule: Molecule;
  onChange: (amount: number) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    menuRef.current?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="charge-menu"
      role="menu"
      tabIndex={-1}
      aria-label="Edit molecule charge"
      style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 110) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="charge-menu__label">Charge</span>
      <strong>{molecule.charge > 0 ? "+" : ""}{molecule.charge}</strong>
      <div>
        <button type="button" role="menuitem" aria-label="Decrease charge" onClick={() => onChange(-1)}>−</button>
        <button type="button" role="menuitem" aria-label="Increase charge" onClick={() => onChange(1)}>+</button>
      </div>
    </div>
  );
}

function MoleculeEditor({
  destination,
  onClose,
  onSave,
}: {
  destination: Side;
  onClose: () => void;
  onSave: (molecule: Molecule) => void;
}) {
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(null);
  const [pendingAtom, setPendingAtom] = useState<PendingAtom | null>(null);
  const [symbol, setSymbol] = useState("");
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const selectedAtom = atoms.find((atom) => atom.id === selectedAtomId);

  useEffect(() => {
    symbolInputRef.current?.focus();
  }, [pendingAtom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingAtom) {
        setPendingAtom(null);
        setSymbol("");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pendingAtom]);

  const isOccupied = (x: number, y: number) => atoms.some((atom) => atom.x === x && atom.y === y);
  const startAtom = (candidate: PendingAtom) => {
    setPendingAtom(candidate);
    setSymbol("");
  };
  const commitAtom = () => {
    if (!pendingAtom || !symbol) return;
    const atom: Atom = { id: crypto.randomUUID(), symbol, x: pendingAtom.x, y: pendingAtom.y };
    setAtoms((current) => [...current, atom]);
    if (pendingAtom.parentId) {
      setBonds((current) => [...current, { from: pendingAtom.parentId!, to: atom.id }]);
    }
    setSelectedAtomId(atom.id);
    setPendingAtom(null);
    setSymbol("");
  };

  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    atoms.forEach((atom) => counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1));
    return Array.from(counts, ([partSymbol, count]) => ({ symbol: partSymbol, count }));
  }, [atoms]);

  const save = () => {
    if (atoms.length === 0) return;
    onSave({ id: crypto.randomUUID(), atoms, bonds, formula: composition, charge: 0 });
  };

  return (
    <div className="editor-backdrop" role="presentation">
      <section className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-heading">
          <div>
            <p>{destination === "reactants" ? "Reactants" : "Products"}</p>
            <h2 id="editor-title">Molecule Editor</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close molecule editor" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="editor-stage" aria-label="Molecule canvas">
          <svg className="bond-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {bonds.map((bond) => {
              const from = atoms.find((atom) => atom.id === bond.from);
              const to = atoms.find((atom) => atom.id === bond.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${bond.from}-${bond.to}`}
                  x1={50 + from.x * 14}
                  y1={50 + from.y * 20}
                  x2={50 + to.x * 14}
                  y2={50 + to.y * 20}
                />
              );
            })}
          </svg>

          {atoms.map((atom) => (
            <button
              key={atom.id}
              type="button"
              className={`atom-node${selectedAtomId === atom.id ? " atom-node--selected" : ""}`}
              style={{ left: `${50 + atom.x * 14}%`, top: `${50 + atom.y * 20}%` }}
              aria-label={`${atom.symbol} atom. Select to add a bonded atom.`}
              onClick={() => setSelectedAtomId(atom.id)}
            >
              {atom.symbol}
            </button>
          ))}

          {selectedAtom && !pendingAtom && directions.map((direction) => {
            const x = selectedAtom.x + direction.x;
            const y = selectedAtom.y + direction.y;
            if (isOccupied(x, y)) return null;
            return (
              <button
                key={direction.label}
                type="button"
                className="direction-slot"
                style={{ left: `${50 + x * 14}%`, top: `${50 + y * 20}%` }}
                aria-label={`Add atom ${direction.label} ${selectedAtom.symbol}`}
                onClick={() => startAtom({ x, y, parentId: selectedAtom.id })}
              >
                <PlusIcon />
              </button>
            );
          })}

          {atoms.length === 0 && !pendingAtom && (
            <button type="button" className="initial-atom" aria-label="Add the first atom" onClick={() => startAtom({ x: 0, y: 0 })}>
              <PlusIcon />
            </button>
          )}

          {pendingAtom && (
            <div className="atom-entry" style={{ left: `${50 + pendingAtom.x * 14}%`, top: `${50 + pendingAtom.y * 20}%` }}>
              <input
                ref={symbolInputRef}
                value={symbol}
                maxLength={2}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                aria-label="Element shorthand"
                placeholder="X"
                onChange={(event) => {
                  setSymbol(normalizeSymbol(event.target.value));
                }}
                onKeyDown={(event) => event.key === "Enter" && commitAtom()}
                onBlur={() => symbol && commitAtom()}
              />
              <span>Enter to place</span>
            </div>
          )}
        </div>

        <footer className="editor-footer">
          <p>{atoms.length === 0 ? "Start with an atom, then build in four directions." : "Select an atom to extend the structure."}</p>
          <button className="done-button" type="button" disabled={atoms.length === 0} onClick={save}>Done</button>
        </footer>
      </section>
    </div>
  );
}

export default function App() {
  const [molecules, setMolecules] = useState(seedMolecules);
  const [editorSide, setEditorSide] = useState<Side | null>(null);
  const [chargeMenu, setChargeMenu] = useState<ChargeMenuState | null>(null);

  const saveMolecule = useCallback((side: Side, molecule: Molecule) => {
    setMolecules((current) => ({ ...current, [side]: [...current[side], molecule] }));
    setEditorSide(null);
  }, []);

  const updateCharge = (amount: number) => {
    if (!chargeMenu) return;
    setMolecules((current) => ({
      ...current,
      [chargeMenu.side]: current[chargeMenu.side].map((molecule) =>
        molecule.id === chargeMenu.moleculeId ? { ...molecule, charge: molecule.charge + amount } : molecule,
      ),
    }));
  };

  const selectedChargeMolecule = chargeMenu
    ? molecules[chargeMenu.side].find((molecule) => molecule.id === chargeMenu.moleculeId)
    : undefined;

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(context.registerTool({
      name: "add_molecule",
      title: "Add molecule",
      description: "Add a compact demo molecule to either the reactants or products panel.",
      inputSchema: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["reactants", "products"] },
          elements: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: "^[A-Za-z]{1,2}$" },
          },
          charge: { type: "integer", default: 0 },
        },
        required: ["side", "elements"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const candidate = input as { side?: unknown; elements?: unknown; charge?: unknown };
        if (candidate.side !== "reactants" && candidate.side !== "products") {
          throw new Error("Side must be reactants or products.");
        }
        const side: Side = candidate.side;
        if (!Array.isArray(candidate.elements) || candidate.elements.length === 0) {
          throw new Error("At least one element shorthand is required.");
        }
        const elements = candidate.elements.map((value) => normalizeSymbol(String(value)));
        if (elements.some((value) => !value)) {
          throw new Error("Each shorthand must contain one or two letters.");
        }
        const charge = typeof candidate.charge === "number" && Number.isInteger(candidate.charge)
          ? candidate.charge
          : 0;
        const molecule = moleculeFromSymbols(elements, charge);
        setMolecules((current) => ({
          ...current,
          [side]: [...current[side], molecule],
        }));
        return { id: molecule.id, side, formula: formatFormulaLabel(molecule.formula), charge };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  return (
    <main className="app-shell">
      <ShaderBackground />
      <header className="brand-bar glass-panel">
        <p>ChemiSuite</p>
        <span aria-hidden="true">·</span>
        <h1>Mechanism Visualizer</h1>
      </header>

      <div className="workspace">
        <MoleculePanel side="reactants" title="Reactants" molecules={molecules.reactants} onAdd={() => setEditorSide("reactants")} onOpenChargeMenu={setChargeMenu} />
        <MoleculePanel side="products" title="Products" molecules={molecules.products} onAdd={() => setEditorSide("products")} onOpenChargeMenu={setChargeMenu} />
      </div>

      {chargeMenu && selectedChargeMolecule && (
        <ChargeMenu menu={chargeMenu} molecule={selectedChargeMolecule} onChange={updateCharge} onClose={() => setChargeMenu(null)} />
      )}
      {editorSide && (
        <MoleculeEditor destination={editorSide} onClose={() => setEditorSide(null)} onSave={(molecule) => saveMolecule(editorSide, molecule)} />
      )}
    </main>
  );
}
