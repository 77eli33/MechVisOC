import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShaderBackground from "./ShaderBackground";

type Side = "reactants" | "products";
type Atom = { id: string; symbol: string; x: number; y: number; formalCharge: number };
type BondOrder = 1 | 2 | 3;
type Bond = { from: string; to: string; order: BondOrder };
type FormulaPart = { symbol: string; count: number };
type Molecule = {
  id: string;
  atoms: Atom[];
  bonds: Bond[];
  formula: FormulaPart[];
  charge: number;
};
type BucketAtom = { molecule_id: string; atom_id: string };
type AtomBucket = { element_name: string; atoms: BucketAtom[] };
type AtomMapping = { reactant: BucketAtom; product: BucketAtom };
type AtomMappingResult = {
  reactant_buckets: AtomBucket[];
  product_buckets: AtomBucket[];
  atom_mappings: AtomMapping[];
};
type BackboneAnalysis = { molecule: Molecule; backboneAtomIds: string[] };
type PendingAtom = { x: number; y: number; parentId?: string; atomId?: string };
type MoleculeMenuState = { side: Side; moleculeId: string; x: number; y: number };
type EditorState = { side: Side; molecule?: Molecule };
type ApiMolecule = {
  id: string;
  name: string;
  charge: number;
  atoms: Array<{ id: string; element: string; x: number; y: number; formal_charge: number }>;
  bonds: Array<{ atom1_id: string; atom2_id: string; order: number }>;
};
type ApiMoleculeCollection = { molecules: ApiMolecule[] };
type ValidationResult = { valid: boolean; errors: string[]; molecule?: ApiMolecule | null };
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

// Keep the working plane large enough to feel unbounded while retaining native,
// accessible scrolling. Atom positions land on every fourth background dot.
const EDITOR_PLANE_SIZE = 6720;
const EDITOR_PLANE_CENTER = EDITOR_PLANE_SIZE / 2;
const EDITOR_ATOM_STEP = 112;
const BOND_LINE_OFFSETS: Record<BondOrder, number[]> = {
  1: [0],
  2: [-4, 4],
  3: [-7, 0, 7],
};

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

const MenuIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 32 24">
    <path d="M2 3h28M2 12h28M2 21h28" />
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
  const atoms = symbols.map((symbol, index) => ({ id: crypto.randomUUID(), symbol, x: index, y: 0, formalCharge: 0 }));
  return {
    id: crypto.randomUUID(),
    atoms,
    bonds: atoms.slice(1).map((atom, index) => ({ from: atoms[index].id, to: atom.id, order: 1 })),
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
      formal_charge: atom.formalCharge,
    })),
    bonds: molecule.bonds.map((bond) => ({ atom1_id: bond.from, atom2_id: bond.to, order: bond.order })),
  };
}

function fromApiMolecule(molecule: ApiMolecule): Molecule {
  const atoms = molecule.atoms.map((atom) => ({
    id: atom.id,
    symbol: atom.element,
    x: atom.x,
    y: atom.y,
    formalCharge: atom.formal_charge,
  }));
  return {
    id: molecule.id,
    atoms,
    bonds: molecule.bonds.map((bond) => ({ from: bond.atom1_id, to: bond.atom2_id, order: bond.order as BondOrder })),
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

async function requestValidation(path: string, body: object, signal?: AbortSignal): Promise<ValidationResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const responseBody = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(typeof responseBody?.detail === "string" ? responseBody.detail : "Validation could not be completed.");
  }
  return await response.json() as ValidationResult;
}

function validateEnteredAtoms(atoms: Atom[], signal?: AbortSignal) {
  return requestValidation(
    "/api/validate-atoms",
    { atoms: atoms.map((atom) => ({ id: atom.id, element: atom.symbol })) },
    signal,
  );
}

function validateCompletedMolecule(molecule: Molecule): Promise<ValidationResult> {
  return requestValidation("/api/validate-molecule", { molecule: toApiMolecule(molecule) });
}

async function sendReactionForAtomMapping(molecules: Record<Side, Molecule[]>): Promise<AtomMappingResult> {
  const reactants: ApiMoleculeCollection = { molecules: molecules.reactants.map(toApiMolecule) };
  const products: ApiMoleculeCollection = { molecules: molecules.products.map(toApiMolecule) };
  const response = await fetch("/api/atom-mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reactants, products }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? "The reaction could not be transferred for atom mapping.");
  }
  return await response.json() as AtomMappingResult;
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
  onOpenMoleculeMenu,
}: {
  molecule: Molecule;
  side: Side;
  selected: boolean;
  onSelect: () => void;
  onOpenMoleculeMenu: (menu: MoleculeMenuState) => void;
}) {
  const label = `${formatFormulaLabel(molecule.formula)}, ${chargeLabel(molecule.charge)} charge`;
  return (
    <button
      className="molecule-chip"
      type="button"
      aria-label={`${label}. Click to select; right-click for molecule actions.`}
      aria-pressed={selected}
      title="Click to select · Right-click for molecule actions"
      onClick={onSelect}
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
  onOpenMoleculeMenu,
}: {
  side: Side;
  title: string;
  molecules: Molecule[];
  selectedMoleculeId: string | null;
  onSelect: (molecule: Molecule) => void;
  onAdd: () => void;
  onOpenMoleculeMenu: (menu: MoleculeMenuState) => void;
}) {
  return (
    <section className="molecule-panel" aria-labelledby={`${side}-title`}>
      <header className="panel-heading">
        <h2 id={`${side}-title`}>{title}</h2>
      </header>
      <div className="molecule-row">
        {molecules.map((molecule, index) => (
          <Fragment key={molecule.id}>
            {index > 0 && <span className="reaction-plus" aria-hidden="true">+</span>}
            <MoleculeChip
              molecule={molecule}
              side={side}
              selected={selectedMoleculeId === molecule.id}
              onSelect={() => onSelect(molecule)}
              onOpenMoleculeMenu={onOpenMoleculeMenu}
            />
          </Fragment>
        ))}
        <button className="add-molecule" type="button" aria-label={`Add molecule to ${title}`} onClick={onAdd}>
          <PlusIcon />
        </button>
      </div>
    </section>
  );
}

function SideMenu({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="side-menu-backdrop" role="presentation" onPointerDown={onClose}>
      <aside
        className="side-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="side-menu-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="side-menu-title">Menu</h2>
          <button ref={closeButtonRef} type="button" aria-label="Close menu" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
      </aside>
    </div>
  );
}

function MoleculeMenu({
  menu,
  molecule,
  onChangeCharge,
  onEdit,
  onRemove,
  onClose,
}: {
  menu: MoleculeMenuState;
  molecule: Molecule;
  onChangeCharge: (amount: number) => void;
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
      style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 205) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="molecule-menu__charge">
        <span>Charge</span>
        <strong>{molecule.charge > 0 ? "+" : ""}{molecule.charge}</strong>
        <div>
          <button type="button" role="menuitem" aria-label="Decrease charge" onClick={() => onChangeCharge(-1)}>−</button>
          <button type="button" role="menuitem" aria-label="Increase charge" onClick={() => onChangeCharge(1)}>+</button>
        </div>
      </div>
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

function AtomMappingsPanel({ mappings, molecules }: { mappings: AtomMapping[]; molecules: Record<Side, Molecule[]> }) {
  const atomSymbols = new Map(
    [...molecules.reactants, ...molecules.products].flatMap((molecule) =>
      molecule.atoms.map((atom) => [`${molecule.id}:${atom.id}`, atom.symbol] as const),
    ),
  );
  const atomSymbol = (atom: BucketAtom) => atomSymbols.get(`${atom.molecule_id}:${atom.atom_id}`) ?? "?";
  return (
    <section className="molecule-panel buckets-panel" aria-labelledby="mappings-title">
      <header className="panel-heading">
        <h2 id="mappings-title">Atom mappings</h2>
        <span>{mappings.length} {mappings.length === 1 ? "atom" : "atoms"} mapped</span>
      </header>
      <div className="mapping-list">
        {mappings.length === 0 ? <p>No atoms can be mapped unambiguously yet.</p> : mappings.map((mapping) => (
          <div className="mapping-row" key={`${mapping.reactant.molecule_id}:${mapping.reactant.atom_id}`}>
            <span className="mapping-atom">
              <strong>{atomSymbol(mapping.reactant)}</strong>
              <code>{mapping.reactant.molecule_id}</code>
              <code>{mapping.reactant.atom_id}</code>
            </span>
            <i className="mapping-connection" aria-label="maps to" />
            <span className="mapping-atom">
              <strong>{atomSymbol(mapping.product)}</strong>
              <code>{mapping.product.molecule_id}</code>
              <code>{mapping.product.atom_id}</code>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MoleculeEditor({
  initialMolecule,
  onClose,
  onSave,
}: {
  initialMolecule?: Molecule;
  onClose: () => void;
  onSave: (molecule: Molecule) => void;
}) {
  const [atoms, setAtoms] = useState<Atom[]>(() => initialMolecule?.atoms.map((atom) => ({ ...atom })) ?? []);
  const [bonds, setBonds] = useState<Bond[]>(() => initialMolecule?.bonds.map((bond) => ({ ...bond })) ?? []);
  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(initialMolecule?.atoms[0]?.id ?? null);
  const [pendingAtom, setPendingAtom] = useState<PendingAtom | null>(null);
  const [symbol, setSymbol] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const selectedAtom = atoms.find((atom) => atom.id === selectedAtomId);

  const editorPosition = (x: number, y: number) => ({
    left: EDITOR_PLANE_CENTER + x * EDITOR_ATOM_STEP,
    top: EDITOR_PLANE_CENTER + y * EDITOR_ATOM_STEP,
  });

  const beginClose = useCallback((afterClose?: () => void) => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      if (afterClose) afterClose();
      else onClose();
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
  }, [isClosing, onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft = EDITOR_PLANE_CENTER - stage.clientWidth / 2;
      stage.scrollTop = EDITOR_PLANE_CENTER - stage.clientHeight / 2;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    symbolInputRef.current?.focus();
  }, [pendingAtom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingAtom) {
          setPendingAtom(null);
          setSymbol("");
          setValidationError(null);
        } else {
          beginClose();
        }
        return;
      }

      if (event.key !== "Backspace" || pendingAtom || !selectedAtomId) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setAtoms((current) => current.filter((atom) => atom.id !== selectedAtomId));
      setBonds((current) => current.filter((bond) => bond.from !== selectedAtomId && bond.to !== selectedAtomId));
      setSelectedAtomId((currentId) => atoms.find((atom) => atom.id !== currentId)?.id ?? null);
      setValidationError(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atoms, beginClose, pendingAtom, selectedAtomId]);

  useEffect(() => {
    if (!pendingAtom || !symbol) {
      setValidationError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const candidate = { id: pendingAtom.atomId ?? "pending-atom", symbol, x: pendingAtom.x, y: pendingAtom.y, formalCharge: 0 };
      const candidateAtoms = pendingAtom.atomId
        ? atoms.map((atom) => atom.id === pendingAtom.atomId ? candidate : atom)
        : [...atoms, candidate];
      void validateEnteredAtoms(candidateAtoms, controller.signal)
        .then((result) => setValidationError(result.errors[0] ?? null))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setValidationError(error instanceof Error ? error.message : "Validation could not be completed.");
          }
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [atoms, pendingAtom, symbol]);

  const isOccupied = (x: number, y: number) => atoms.some((atom) => atom.x === x && atom.y === y);
  const startAtom = (candidate: PendingAtom, initialSymbol = "") => {
    setPendingAtom(candidate);
    setSymbol(initialSymbol);
    setValidationError(null);
  };
  const commitAtom = async () => {
    if (!pendingAtom || !symbol || isValidating) return;
    const atom: Atom = {
      id: pendingAtom.atomId ?? crypto.randomUUID(),
      symbol,
      x: pendingAtom.x,
      y: pendingAtom.y,
      formalCharge: 0,
    };
    const candidateAtoms = pendingAtom.atomId
      ? atoms.map((current) => current.id === pendingAtom.atomId ? atom : current)
      : [...atoms, atom];
    setIsValidating(true);
    setValidationError(null);
    try {
      const result = await validateEnteredAtoms(candidateAtoms);
      if (!result.valid) {
        setValidationError(result.errors[0] ?? "This element is not valid.");
        return;
      }
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Validation could not be completed.");
      return;
    } finally {
      setIsValidating(false);
    }
    if (pendingAtom.atomId) {
      setAtoms(candidateAtoms);
    } else {
      setAtoms((current) => [...current, atom]);
    }
    if (pendingAtom.parentId && !pendingAtom.atomId) {
      setBonds((current) => [...current, { from: pendingAtom.parentId!, to: atom.id, order: 1 }]);
    }
    setSelectedAtomId(atom.id);
    setPendingAtom(null);
    setSymbol("");
  };
  const cycleBondOrder = (bondToCycle: Bond) => {
    setBonds((current) => current.map((bond) => (
      bond.from === bondToCycle.from && bond.to === bondToCycle.to
        ? { ...bond, order: (bond.order === 3 ? 1 : bond.order + 1) as BondOrder }
        : bond
    )));
    setValidationError(null);
  };
  const composition = useMemo(() => formulaFromAtoms(atoms), [atoms]);
  const save = async () => {
    if (atoms.length === 0 || pendingAtom || isValidating) return;
    let molecule = {
      id: initialMolecule?.id ?? crypto.randomUUID(),
      atoms,
      bonds,
      formula: composition,
      charge: initialMolecule?.charge ?? 0,
    };
    setIsValidating(true);
    setValidationError(null);
    try {
      const result = await validateCompletedMolecule(molecule);
      if (!result.valid) {
        setValidationError(result.errors[0] ?? "This molecule is not valid.");
        return;
      }
      if (!result.molecule) {
        setValidationError("Validation did not return the normalized molecule.");
        return;
      }
      molecule = fromApiMolecule(result.molecule);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Validation could not be completed.");
      return;
    } finally {
      setIsValidating(false);
    }
    beginClose(() => onSave(molecule));
  };

  return (
    <div className={`editor-backdrop${isClosing ? " editor-backdrop--closing" : ""}`} role="presentation">
      <section className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-heading">
          <h2 id="editor-title">Molecule Editor</h2>
          <button className="icon-button" type="button" aria-label="Close molecule editor" onClick={() => beginClose()}>
            <CloseIcon />
          </button>
        </header>

        <div ref={stageRef} className="editor-stage" aria-label="Scrollable molecule canvas">
          <div
            className="editor-surface"
            style={{ width: EDITOR_PLANE_SIZE, height: EDITOR_PLANE_SIZE }}
          >
            <svg
              className="bond-layer"
              viewBox={`0 0 ${EDITOR_PLANE_SIZE} ${EDITOR_PLANE_SIZE}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {bonds.map((bond) => {
                const from = atoms.find((atom) => atom.id === bond.from);
                const to = atoms.find((atom) => atom.id === bond.to);
                if (!from || !to) return null;
                const fromPosition = editorPosition(from.x, from.y);
                const toPosition = editorPosition(to.x, to.y);
                const deltaX = toPosition.left - fromPosition.left;
                const deltaY = toPosition.top - fromPosition.top;
                const length = Math.hypot(deltaX, deltaY) || 1;
                const normalX = -deltaY / length;
                const normalY = deltaX / length;
                const orderName = bond.order === 1 ? "single" : bond.order === 2 ? "double" : "triple";
                const cycleBond = () => cycleBondOrder(bond);
                return (
                  <g
                    key={`${bond.from}-${bond.to}`}
                    className="bond-control"
                    role="button"
                    tabIndex={0}
                    aria-label={`${orderName} bond from ${from.symbol} to ${to.symbol}. Activate to change bond order.`}
                    onClick={cycleBond}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        cycleBond();
                      }
                    }}
                  >
                    <line
                      className="bond-hit-area"
                      x1={fromPosition.left}
                      y1={fromPosition.top}
                      x2={toPosition.left}
                      y2={toPosition.top}
                    />
                    {BOND_LINE_OFFSETS[bond.order].map((offset) => (
                      <line
                        className="bond-stroke"
                        key={offset}
                        x1={fromPosition.left + normalX * offset}
                        y1={fromPosition.top + normalY * offset}
                        x2={toPosition.left + normalX * offset}
                        y2={toPosition.top + normalY * offset}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {atoms.filter((atom) => atom.id !== pendingAtom?.atomId).map((atom) => (
              <button
                key={atom.id}
                type="button"
                className={`atom-node${selectedAtomId === atom.id ? " atom-node--selected" : ""}`}
                style={editorPosition(atom.x, atom.y)}
                aria-label={`${atom.symbol} atom. Edit element and select to add a bonded atom.`}
                onClick={() => {
                  setSelectedAtomId(atom.id);
                  startAtom({ x: atom.x, y: atom.y, atomId: atom.id }, atom.symbol);
                }}
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
                  style={editorPosition(x, y)}
                  aria-label={`Add atom ${direction.label} ${selectedAtom.symbol}`}
                  onClick={() => startAtom({ x, y, parentId: selectedAtom.id })}
                >
                  <PlusIcon />
                </button>
              );
            })}

            {atoms.length === 0 && !pendingAtom && (
              <button
                type="button"
                className="initial-atom"
                style={editorPosition(0, 0)}
                aria-label="Add the first atom"
                onClick={() => startAtom({ x: 0, y: 0 })}
              >
                <PlusIcon />
              </button>
            )}

            {pendingAtom && (
              <div className="atom-entry" style={editorPosition(pendingAtom.x, pendingAtom.y)}>
                <input
                  ref={symbolInputRef}
                  value={symbol}
                  maxLength={2}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Element shorthand"
                  onChange={(event) => setSymbol(normalizeSymbol(event.target.value))}
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={validationError ? "editor-validation-error" : undefined}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitAtom();
                  }}
                  onBlur={() => {
                    if (symbol) void commitAtom();
                  }}
                />
                <span>Enter to place</span>
              </div>
            )}
          </div>
        </div>

        <footer className="editor-footer">
          {validationError && <p className="editor-validation-error" id="editor-validation-error" role="alert">{validationError}</p>}
          <button className="done-button" type="button" disabled={atoms.length === 0 || Boolean(pendingAtom) || isValidating} onClick={() => void save()}>{isValidating ? "Checking…" : "Done"}</button>
        </footer>
      </section>
    </div>
  );
}

export default function App() {
  const [molecules, setMolecules] = useState<Record<Side, Molecule[]>>(emptyMolecules);
  const [selectedMoleculeId, setSelectedMoleculeId] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<AtomMappingResult | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [moleculeMenu, setMoleculeMenu] = useState<MoleculeMenuState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const allMolecules = [...molecules.reactants, ...molecules.products];
  const selectedMolecule = allMolecules.find((molecule) => molecule.id === selectedMoleculeId);
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
    setBuckets(null);
    setRunError(null);
    setEditorState(null);
  }, []);

  const selectMolecule = (molecule: Molecule) => {
    setSelectedMoleculeId(molecule.id);
    setRunError(null);
  };

  const updateCharge = (amount: number) => {
    if (!moleculeMenu) return;
    setMolecules((current) => ({
      ...current,
      [moleculeMenu.side]: current[moleculeMenu.side].map((molecule) =>
        molecule.id === moleculeMenu.moleculeId ? { ...molecule, charge: molecule.charge + amount } : molecule,
      ),
    }));
    setBuckets(null);
  };

  const removeMolecule = (side: Side, moleculeId: string) => {
    setMolecules((current) => ({
      ...current,
      [side]: current[side].filter((molecule) => molecule.id !== moleculeId),
    }));
    if (selectedMoleculeId === moleculeId) setSelectedMoleculeId(null);
    setBuckets(null);
    setMoleculeMenu(null);
    setRunError(null);
  };

  const openMoleculeMenu = (menu: MoleculeMenuState) => {
    setMoleculeMenu(menu);
  };

  const runAnalysis = async () => {
    if (!selectedMolecule) return;
    setIsRunning(true);
    setRunError(null);
    try {
      setBuckets(await sendReactionForAtomMapping(molecules));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The atom buckets could not be generated.");
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
        setBuckets(null);
        return { id: molecule.id, side, formula: formatFormulaLabel(molecule.formula), charge };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="app-shell">
      <ShaderBackground />
      <header className="brand-bar glass-panel">
        <div className="brand-lockup">
          <p>ChemiSuite:</p>
          <h1>Mechanism Visualizer</h1>
        </div>
        <button className="header-menu-button" type="button" aria-label="Open menu" onClick={() => setIsMenuOpen(true)}>
          <MenuIcon />
        </button>
      </header>

      <div className="workspace">
        <MoleculePanel
          side="reactants"
          title="Reactants"
          molecules={molecules.reactants}
          selectedMoleculeId={selectedMoleculeId}
          onSelect={selectMolecule}
          onAdd={() => setEditorState({ side: "reactants" })}
          onOpenMoleculeMenu={openMoleculeMenu}
        />
        {buckets && <AtomMappingsPanel mappings={buckets.atom_mappings} molecules={molecules} />}
        <MoleculePanel
          side="products"
          title="Products"
          molecules={molecules.products}
          selectedMoleculeId={selectedMoleculeId}
          onSelect={selectMolecule}
          onAdd={() => setEditorState({ side: "products" })}
          onOpenMoleculeMenu={openMoleculeMenu}
        />
      </div>

      <div className="run-control">
        {runError && <p role="alert">{runError}</p>}
        <button type="button" className="run-button" disabled={!selectedMolecule || isRunning} onClick={runAnalysis}>
          {isRunning ? "Running…" : "Run"}
        </button>
      </div>

      {moleculeMenu && selectedActionMolecule && (
        <MoleculeMenu
          menu={moleculeMenu}
          molecule={selectedActionMolecule}
          onChangeCharge={updateCharge}
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
          initialMolecule={editorState.molecule}
          onClose={() => setEditorState(null)}
          onSave={(molecule) => saveMolecule(editorState.side, molecule)}
        />
      )}
      {isMenuOpen && <SideMenu onClose={() => setIsMenuOpen(false)} />}
    </main>
  );
}
