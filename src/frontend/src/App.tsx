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
type BackboneAnalysis = { molecule: Molecule; backboneAtomIds: string[] };
type PendingAtom = { x: number; y: number; parentId?: string };
type ChargeMenuState = { side: Side; moleculeId: string; x: number; y: number };
type MoleculeMenuState = { side: Side; moleculeId: string; x: number; y: number };
type EditorState = { side: Side; molecule?: Molecule };
type ApiMolecule = {
  id: string;
  name: string;
  charge: number;
  atoms: Array<{ id: string; element: string; x: number; y: number; formal_charge: number }>;
  bonds: Array<{ atom1_id: string; atom2_id: string; order: number }>;
};
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

const emptyMolecules: Record<Side, Molecule[]> = { reactants: [], products: [] };

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

function formulaFromAtoms(atoms: Atom[]) {
  const counts = new Map<string, number>();
  atoms.forEach((atom) => counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1));
  return Array.from(counts, ([symbol, count]) => ({ symbol, count }));
}

function moleculeFromSymbols(symbols: string[], charge = 0): Molecule {
  const atoms = symbols.map((symbol, index) => ({ id: crypto.randomUUID(), symbol, x: index, y: 0 }));
  return {
    id: crypto.randomUUID(),
    atoms,
    bonds: atoms.slice(1).map((atom, index) => ({ from: atoms[index].id, to: atom.id })),
    formula: formulaFromAtoms(atoms),
    charge,
  };
}

function toApiMolecule(molecule: Molecule): ApiMolecule {
  return {
    id: molecule.id,
    name: formatFormulaLabel(molecule.formula),
    charge: molecule.charge,
    atoms: molecule.atoms.map((atom) => ({
      id: atom.id,
      element: atom.symbol,
      x: atom.x,
      y: atom.y,
      formal_charge: 0,
    })),
    bonds: molecule.bonds.map((bond) => ({ atom1_id: bond.from, atom2_id: bond.to, order: 1 })),
  };
}

function fromApiMolecule(molecule: ApiMolecule): Molecule {
  const atoms = molecule.atoms.map((atom) => ({ id: atom.id, symbol: atom.element, x: atom.x, y: atom.y }));
  return {
    id: molecule.id,
    atoms,
    bonds: molecule.bonds.map((bond) => ({ from: bond.atom1_id, to: bond.atom2_id })),
    formula: formulaFromAtoms(atoms),
    charge: molecule.charge,
  };
}

async function requestBackbone(molecule: Molecule): Promise<BackboneAnalysis> {
  const response = await fetch("/api/backbone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ molecule: toApiMolecule(molecule) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? "The backbone analysis could not be completed.");
  }
  const body = await response.json() as { molecule: ApiMolecule; backbone_atom_ids: string[] };
  return { molecule: fromApiMolecule(body.molecule), backboneAtomIds: body.backbone_atom_ids };
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
  selected,
  onSelect,
  onOpenChargeMenu,
  onOpenMoleculeMenu,
}: {
  molecule: Molecule;
  side: Side;
  selected: boolean;
  onSelect: () => void;
  onOpenChargeMenu: (menu: ChargeMenuState) => void;
  onOpenMoleculeMenu: (menu: MoleculeMenuState) => void;
}) {
  const label = `${formatFormulaLabel(molecule.formula)}, ${chargeLabel(molecule.charge)} charge`;
  return (
    <button
      className={`molecule-chip${selected ? " molecule-chip--selected" : ""}`}
      type="button"
      aria-label={`${label}. Click to edit charge; right-click for edit and remove actions.`}
      aria-pressed={selected}
      title="Click to edit charge · Right-click for more actions"
      onClick={(event) => {
        onSelect();
        onOpenChargeMenu({ side, moleculeId: molecule.id, x: event.clientX, y: event.clientY });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
        onOpenMoleculeMenu({ side, moleculeId: molecule.id, x: event.clientX, y: event.clientY });
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
  selectedMoleculeId,
  onSelect,
  onAdd,
  onOpenChargeMenu,
  onOpenMoleculeMenu,
}: {
  side: Side;
  title: string;
  molecules: Molecule[];
  selectedMoleculeId: string | null;
  onSelect: (molecule: Molecule) => void;
  onAdd: () => void;
  onOpenChargeMenu: (menu: ChargeMenuState) => void;
  onOpenMoleculeMenu: (menu: MoleculeMenuState) => void;
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
            selected={selectedMoleculeId === molecule.id}
            onSelect={() => onSelect(molecule)}
            onOpenChargeMenu={onOpenChargeMenu}
            onOpenMoleculeMenu={onOpenMoleculeMenu}
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

function MoleculeMenu({
  menu,
  onEdit,
  onRemove,
  onClose,
}: {
  menu: MoleculeMenuState;
  onEdit: () => void;
  onRemove: () => void;
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
      className="molecule-menu"
      role="menu"
      tabIndex={-1}
      aria-label="Molecule actions"
      style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 108) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onEdit}>Edit</button>
      <button type="button" role="menuitem" className="molecule-menu__remove" onClick={onRemove}>Remove</button>
    </div>
  );
}

function MoleculeStructure({ analysis }: { analysis: BackboneAnalysis }) {
  const { molecule, backboneAtomIds } = analysis;
  const backboneAtoms = new Set(backboneAtomIds);
  const backboneEdges = new Set(
    backboneAtomIds.slice(1).map((atomId, index) => [backboneAtomIds[index], atomId].sort().join("::")),
  );
  const xs = molecule.atoms.map((atom) => atom.x);
  const ys = molecule.atoms.map((atom) => atom.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const stepX = Math.min(18, 72 / Math.max(1, maxX - minX));
  const stepY = Math.min(24, 68 / Math.max(1, maxY - minY));
  const position = (atom: Atom) => ({ x: 50 + (atom.x - centerX) * stepX, y: 50 + (atom.y - centerY) * stepY });

  return (
    <div className="result-stage" aria-label={`Analyzed structure for ${formatFormulaLabel(molecule.formula)}`}>
      <svg className="result-bonds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {molecule.bonds.map((bond) => {
          const from = molecule.atoms.find((atom) => atom.id === bond.from);
          const to = molecule.atoms.find((atom) => atom.id === bond.to);
          if (!from || !to) return null;
          const start = position(from);
          const end = position(to);
          const key = [bond.from, bond.to].sort().join("::");
          return (
            <line
              key={key}
              className={backboneEdges.has(key) ? "result-bond--backbone" : ""}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
            />
          );
        })}
      </svg>
      {molecule.atoms.map((atom) => {
        const point = position(atom);
        const highlighted = backboneAtoms.has(atom.id);
        return (
          <span
            key={atom.id}
            className={`result-atom${highlighted ? " result-atom--backbone" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            aria-label={`${atom.symbol} atom${highlighted ? ", part of backbone" : ""}`}
          >
            {atom.symbol}
          </span>
        );
      })}
    </div>
  );
}

function BackbonePanel({ analysis }: { analysis: BackboneAnalysis }) {
  const count = analysis.backboneAtomIds.length;
  return (
    <section className="molecule-panel backbone-panel" aria-labelledby="backbone-title">
      <header className="panel-heading">
        <h2 id="backbone-title">Backbone</h2>
        <span>{count > 0 ? `${count} ${count === 1 ? "atom" : "atoms"} found` : "No backbone found"}</span>
      </header>
      <MoleculeStructure analysis={analysis} />
      <div className="backbone-legend"><i aria-hidden="true" /> Highlighted backbone</div>
    </section>
  );
}

function MoleculeEditor({
  destination,
  initialMolecule,
  onClose,
  onSave,
}: {
  destination: Side;
  initialMolecule?: Molecule;
  onClose: () => void;
  onSave: (molecule: Molecule) => void;
}) {
  const [atoms, setAtoms] = useState<Atom[]>(() => initialMolecule?.atoms.map((atom) => ({ ...atom })) ?? []);
  const [bonds, setBonds] = useState<Bond[]>(() => initialMolecule?.bonds.map((bond) => ({ ...bond })) ?? []);
  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(initialMolecule?.atoms[0]?.id ?? null);
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
  const composition = useMemo(() => formulaFromAtoms(atoms), [atoms]);
  const save = () => {
    if (atoms.length === 0 || pendingAtom) return;
    const molecule = {
      id: initialMolecule?.id ?? crypto.randomUUID(),
      atoms,
      bonds,
      formula: composition,
      charge: initialMolecule?.charge ?? 0,
    };
    onSave(molecule);
  };

  return (
    <div className="editor-backdrop" role="presentation">
      <section className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-heading">
          <div>
            <p>{destination === "reactants" ? "Reactants" : "Products"}</p>
            <h2 id="editor-title">{initialMolecule ? "Edit Molecule" : "Molecule Editor"}</h2>
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
              return <line key={`${bond.from}-${bond.to}`} x1={50 + from.x * 14} y1={50 + from.y * 20} x2={50 + to.x * 14} y2={50 + to.y * 20} />;
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
            if (isOccupied(x, y) || Math.abs(x) > 3 || Math.abs(y) > 2) return null;
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
                onChange={(event) => setSymbol(normalizeSymbol(event.target.value))}
                onKeyDown={(event) => event.key === "Enter" && commitAtom()}
                onBlur={() => symbol && commitAtom()}
              />
              <span>Enter to place</span>
            </div>
          )}
        </div>

        <footer className="editor-footer">
          <p>{atoms.length === 0 ? "Start with an atom, then build in four directions." : "Select an atom to extend the structure."}</p>
          <button className="done-button" type="button" disabled={atoms.length === 0 || Boolean(pendingAtom)} onClick={save}>Done</button>
        </footer>
      </section>
    </div>
  );
}

export default function App() {
  const [molecules, setMolecules] = useState<Record<Side, Molecule[]>>(emptyMolecules);
  const [selectedMoleculeId, setSelectedMoleculeId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<BackboneAnalysis | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [chargeMenu, setChargeMenu] = useState<ChargeMenuState | null>(null);
  const [moleculeMenu, setMoleculeMenu] = useState<MoleculeMenuState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const allMolecules = [...molecules.reactants, ...molecules.products];
  const selectedMolecule = allMolecules.find((molecule) => molecule.id === selectedMoleculeId);
  const selectedChargeMolecule = chargeMenu
    ? molecules[chargeMenu.side].find((molecule) => molecule.id === chargeMenu.moleculeId)
    : undefined;
  const selectedActionMolecule = moleculeMenu
    ? molecules[moleculeMenu.side].find((molecule) => molecule.id === moleculeMenu.moleculeId)
    : undefined;

  const saveMolecule = useCallback((side: Side, molecule: Molecule) => {
    setMolecules((current) => {
      const exists = current[side].some((currentMolecule) => currentMolecule.id === molecule.id);
      return {
        ...current,
        [side]: exists
          ? current[side].map((currentMolecule) => currentMolecule.id === molecule.id ? molecule : currentMolecule)
          : [...current[side], molecule],
      };
    });
    setSelectedMoleculeId(molecule.id);
    setAnalysis(null);
    setRunError(null);
    setEditorState(null);
  }, []);

  const selectMolecule = (molecule: Molecule) => {
    setSelectedMoleculeId(molecule.id);
    if (analysis?.molecule.id !== molecule.id) setAnalysis(null);
    setRunError(null);
  };

  const updateCharge = (amount: number) => {
    if (!chargeMenu) return;
    setMolecules((current) => ({
      ...current,
      [chargeMenu.side]: current[chargeMenu.side].map((molecule) =>
        molecule.id === chargeMenu.moleculeId ? { ...molecule, charge: molecule.charge + amount } : molecule,
      ),
    }));
    setAnalysis((current) => current?.molecule.id === chargeMenu.moleculeId
      ? { ...current, molecule: { ...current.molecule, charge: current.molecule.charge + amount } }
      : current);
  };

  const removeMolecule = (side: Side, moleculeId: string) => {
    setMolecules((current) => ({
      ...current,
      [side]: current[side].filter((molecule) => molecule.id !== moleculeId),
    }));
    if (selectedMoleculeId === moleculeId) setSelectedMoleculeId(null);
    if (analysis?.molecule.id === moleculeId) setAnalysis(null);
    setMoleculeMenu(null);
    setRunError(null);
  };

  const openChargeMenu = (menu: ChargeMenuState) => {
    setMoleculeMenu(null);
    setChargeMenu(menu);
  };

  const openMoleculeMenu = (menu: MoleculeMenuState) => {
    setChargeMenu(null);
    setMoleculeMenu(menu);
  };

  const runBackbone = async () => {
    if (!selectedMolecule) return;
    setIsRunning(true);
    setRunError(null);
    try {
      setAnalysis(await requestBackbone(selectedMolecule));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The backbone analysis could not be completed.");
    } finally {
      setIsRunning(false);
    }
  };

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
          elements: { type: "array", minItems: 1, items: { type: "string", pattern: "^[A-Za-z]{1,2}$" } },
          charge: { type: "integer", default: 0 },
        },
        required: ["side", "elements"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const candidate = input as { side?: unknown; elements?: unknown; charge?: unknown };
        if (candidate.side !== "reactants" && candidate.side !== "products") throw new Error("Side must be reactants or products.");
        if (!Array.isArray(candidate.elements) || candidate.elements.length === 0) throw new Error("At least one element shorthand is required.");
        const side: Side = candidate.side;
        const elements = candidate.elements.map((value) => normalizeSymbol(String(value)));
        if (elements.some((value) => !value)) throw new Error("Each shorthand must contain one or two letters.");
        const charge = typeof candidate.charge === "number" && Number.isInteger(candidate.charge) ? candidate.charge : 0;
        const molecule = moleculeFromSymbols(elements, charge);
        setMolecules((current) => ({ ...current, [side]: [...current[side], molecule] }));
        setSelectedMoleculeId(molecule.id);
        setAnalysis(null);
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
        <MoleculePanel
          side="reactants"
          title="Reactants"
          molecules={molecules.reactants}
          selectedMoleculeId={selectedMoleculeId}
          onSelect={selectMolecule}
          onAdd={() => setEditorState({ side: "reactants" })}
          onOpenChargeMenu={openChargeMenu}
          onOpenMoleculeMenu={openMoleculeMenu}
        />
        {analysis && <BackbonePanel analysis={analysis} />}
        <MoleculePanel
          side="products"
          title="Products"
          molecules={molecules.products}
          selectedMoleculeId={selectedMoleculeId}
          onSelect={selectMolecule}
          onAdd={() => setEditorState({ side: "products" })}
          onOpenChargeMenu={openChargeMenu}
          onOpenMoleculeMenu={openMoleculeMenu}
        />
      </div>

      <div className="run-control">
        {runError && <p role="alert">{runError}</p>}
        <button type="button" className="run-button" disabled={!selectedMolecule || isRunning} onClick={runBackbone}>
          {isRunning ? "Running…" : "Run"}
        </button>
      </div>

      {chargeMenu && selectedChargeMolecule && (
        <ChargeMenu menu={chargeMenu} molecule={selectedChargeMolecule} onChange={updateCharge} onClose={() => setChargeMenu(null)} />
      )}
      {moleculeMenu && selectedActionMolecule && (
        <MoleculeMenu
          menu={moleculeMenu}
          onEdit={() => {
            setEditorState({ side: moleculeMenu.side, molecule: selectedActionMolecule });
            setMoleculeMenu(null);
          }}
          onRemove={() => removeMolecule(moleculeMenu.side, selectedActionMolecule.id)}
          onClose={() => setMoleculeMenu(null)}
        />
      )}
      {editorState && (
        <MoleculeEditor
          destination={editorState.side}
          initialMolecule={editorState.molecule}
          onClose={() => setEditorState(null)}
          onSave={(molecule) => saveMolecule(editorState.side, molecule)}
        />
      )}
    </main>
  );
}
