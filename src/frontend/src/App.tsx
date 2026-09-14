import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShaderBackground from "./ShaderBackground";
import ElectronFlow from "./ElectronFlow";
import type { ElectronFlow as ElectronFlowData } from "./electronFlowLayout";
import {
  EDITOR_DIRECTIONS,
  formatFormalCharge,
  freeSlots,
  nextNavigationTarget,
  type NavigationTarget,
} from "./moleculeEditorGeometry";
import { formulaFromAtoms, type FormulaPart } from "./moleculeFormula";

type Side = "reactants" | "products";
type Atom = {
  id: string;
  symbol: string;
  x: number;
  y: number;
  formalCharge: number;
  implicitHydrogens: number;
};
type BondOrder = 1 | 2 | 3;
type Bond = { from: string; to: string; order: BondOrder };
type Molecule = {
  id: string;
  atoms: Atom[];
  bonds: Bond[];
  formula: FormulaPart[];
  charge: number;
};
type BucketAtom = { molecule_id: string; atom_id: string };
type MappedBond = { atom1: BucketAtom; atom2: BucketAtom; order: BondOrder };
type BondOrderChange = {
  atom1: BucketAtom;
  atom2: BucketAtom;
  old_order: BondOrder;
  new_order: BondOrder;
};
type BondDiff = {
  removed_bonds: MappedBond[];
  added_bonds: MappedBond[];
  order_changed: BondOrderChange[];
};
type ReactionAnalysisResult = { bond_diffs: BondDiff; electron_flow: ElectronFlowData };
type BackboneAnalysis = { molecule: Molecule; backboneAtomIds: string[] };
type PendingAtom = { x: number; y: number; parentId?: string; atomId?: string };
type MoleculeMenuState = { side: Side; moleculeId: string; x: number; y: number };
type EditorState = { side: Side; molecule?: Molecule };
type ApiMolecule = {
  id: string;
  name: string;
  charge: number;
  atoms: Array<{
    id: string;
    element: string;
    x: number;
    y: number;
    formal_charge: number;
    implicit_hydrogens: number;
  }>;
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

// Keep the working plane large enough to feel unbounded while retaining native,
// accessible scrolling. The atom spacing mirrors the electron-flow scene.
const EDITOR_PLANE_SIZE = 6720;
const EDITOR_PLANE_CENTER = EDITOR_PLANE_SIZE / 2;
const EDITOR_ATOM_STEP = 80;
const BOND_LINE_OFFSETS: Record<BondOrder, number[]> = {
  1: [0],
  2: [-3, 3],
  3: [-6, 0, 6],
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

function moleculeFromSymbols(symbols: string[], charge = 0): Molecule {
  const atoms = symbols.map((symbol, index) => ({
    id: crypto.randomUUID(), symbol, x: index, y: 0, formalCharge: 0, implicitHydrogens: 0,
  }));
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
    charge: molecule.atoms.reduce((total, atom) => total + atom.formalCharge, 0),
    atoms: molecule.atoms.map((atom) => ({
      id: atom.id,
      element: atom.symbol,
      x: atom.x,
      y: atom.y,
      formal_charge: atom.formalCharge,
      implicit_hydrogens: atom.implicitHydrogens,
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
    implicitHydrogens: atom.implicit_hydrogens,
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

async function requestReactionAnalysis(molecules: Record<Side, Molecule[]>): Promise<ReactionAnalysisResult> {
  const reactants: ApiMoleculeCollection = { molecules: molecules.reactants.map(toApiMolecule) };
  const products: ApiMoleculeCollection = { molecules: molecules.products.map(toApiMolecule) };
  const response = await fetch("/api/electron-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reactants, products }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? "The reaction could not be transferred for atom mapping.");
  }
  return await response.json() as ReactionAnalysisResult;
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
  onEdit,
  onRemove,
  onClose,
}: {
  menu: MoleculeMenuState;
  molecule: Molecule;
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

function BondDiffsPanel({ diff, molecules }: { diff: BondDiff; molecules: Record<Side, Molecule[]> }) {
  const atomSymbols = new Map(
    [...molecules.reactants, ...molecules.products].flatMap((molecule) =>
      molecule.atoms.map((atom) => [`${molecule.id}:${atom.id}`, atom.symbol] as const),
    ),
  );
  const atomSymbol = (atom: BucketAtom) => atomSymbols.get(`${atom.molecule_id}:${atom.atom_id}`) ?? "?";
  const bondOrderLabel = (order: BondOrder) => order === 1 ? "Single" : order === 2 ? "Double" : "Triple";
  const bondGlyph = (order: BondOrder) => order === 1 ? "—" : order === 2 ? "═" : "≡";
  const changeCount = diff.removed_bonds.length + diff.added_bonds.length + diff.order_changed.length;
  const renderBonds = (bonds: MappedBond[], change: "removed" | "added") => (
    bonds.length === 0 ? <p>None</p> : bonds.map((bond) => (
      <article
        className={`bond-change-card bond-change-card--${change}`}
        key={`${bond.atom1.molecule_id}:${bond.atom1.atom_id}:${bond.atom2.molecule_id}:${bond.atom2.atom_id}:${bond.order}`}
      >
        <div className="bond-change-card__bond">
          <strong>{atomSymbol(bond.atom1)}</strong>
          <i aria-label={`${bondOrderLabel(bond.order)} bond`}>{bondGlyph(bond.order)}</i>
          <strong>{atomSymbol(bond.atom2)}</strong>
        </div>
        <span>{bondOrderLabel(bond.order)} bond</span>
        <div className="bond-change-card__refs">
          <code>{bond.atom1.molecule_id} / {bond.atom1.atom_id}</code>
          <code>{bond.atom2.molecule_id} / {bond.atom2.atom_id}</code>
        </div>
      </article>
    ))
  );
  const renderOrderChanges = () => (
    diff.order_changed.length === 0 ? <p>None</p> : diff.order_changed.map((bond) => (
      <article
        className="bond-change-card bond-change-card--order"
        key={`${bond.atom1.molecule_id}:${bond.atom1.atom_id}:${bond.atom2.molecule_id}:${bond.atom2.atom_id}`}
      >
        <div className="bond-change-card__bond">
          <strong>{atomSymbol(bond.atom1)}</strong>
          <i aria-label={`${bondOrderLabel(bond.old_order)} bond changed to ${bondOrderLabel(bond.new_order)} bond`}>
            {bondGlyph(bond.old_order)} → {bondGlyph(bond.new_order)}
          </i>
          <strong>{atomSymbol(bond.atom2)}</strong>
        </div>
        <span>{bondOrderLabel(bond.old_order)} → {bondOrderLabel(bond.new_order)} bond</span>
        <div className="bond-change-card__refs">
          <code>{bond.atom1.molecule_id} / {bond.atom1.atom_id}</code>
          <code>{bond.atom2.molecule_id} / {bond.atom2.atom_id}</code>
        </div>
      </article>
    ))
  );
  return (
    <section className="molecule-panel bond-diffs-panel" aria-labelledby="bond-diffs-title">
      <header className="panel-heading">
        <h2 id="bond-diffs-title">Bond changes</h2>
        <span>{changeCount} {changeCount === 1 ? "change" : "changes"}</span>
      </header>
      {changeCount === 0 ? (
        <p className="bond-diffs-empty">No bond changes found.</p>
      ) : (
        <div className="bond-diff-groups">
          <section className="bond-diff-group bond-diff-group--removed">
            <h3>Removed</h3>
            {renderBonds(diff.removed_bonds, "removed")}
          </section>
          <section className="bond-diff-group bond-diff-group--added">
            <h3>Added</h3>
            {renderBonds(diff.added_bonds, "added")}
          </section>
          <section className="bond-diff-group bond-diff-group--order">
            <h3>Order changed</h3>
            {renderOrderChanges()}
          </section>
        </div>
      )}
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
  const [hoveredAtomId, setHoveredAtomId] = useState<string | null>(null);
  const [focusedTargetKey, setFocusedTargetKey] = useState(
    initialMolecule?.atoms[0] ? `atom:${initialMolecule.atoms[0].id}` : "initial",
  );
  const [pendingAtom, setPendingAtom] = useState<PendingAtom | null>(null);
  const [symbol, setSymbol] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const targetRefs = useRef(new Map<string, HTMLButtonElement>());
  const hoverTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const selectedAtom = atoms.find((atom) => atom.id === selectedAtomId);

  const focusedAtomId = focusedTargetKey.startsWith("atom:") ? focusedTargetKey.slice(5) : null;
  const focusedSlot = focusedTargetKey.startsWith("slot:")
    ? atoms.flatMap((atom) => freeSlots(atom, atoms)).find((slot) => slot.key === focusedTargetKey)
    : undefined;
  const slotParentId = hoveredAtomId ?? focusedAtomId ?? focusedSlot?.parentId ?? selectedAtomId;
  const slotParent = atoms.find((atom) => atom.id === slotParentId);
  const visibleSlots = !pendingAtom && slotParent ? freeSlots(slotParent, atoms) : [];

  const editorPosition = (x: number, y: number) => ({
    left: EDITOR_PLANE_CENTER + x * EDITOR_ATOM_STEP,
    top: EDITOR_PLANE_CENTER + y * EDITOR_ATOM_STEP,
  });

  const registerTarget = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) targetRefs.current.set(key, node);
    else targetRefs.current.delete(key);
  };

  const focusTarget = (key: string) => {
    setHoveredAtomId(null);
    setFocusedTargetKey(key);
    if (key.startsWith("atom:")) setSelectedAtomId(key.slice(5));
  };

  const startAtom = (candidate: PendingAtom, initialSymbol = "") => {
    setPendingAtom(candidate);
    setSymbol(initialSymbol);
    setValidationError(null);
  };

  const startSlotEntry = (slot: (typeof visibleSlots)[number], initialSymbol = "") => {
    setHoveredAtomId(null);
    setSelectedAtomId(slot.parentId);
    setFocusedTargetKey(slot.key);
    startAtom({ x: slot.x, y: slot.y, parentId: slot.parentId }, initialSymbol);
  };

  const cancelPendingAtom = () => {
    if (!pendingAtom) return;
    const returnAtomId = pendingAtom.parentId ?? pendingAtom.atomId;
    setPendingAtom(null);
    setSymbol("");
    setValidationError(null);
    setFocusedTargetKey(returnAtomId ? `atom:${returnAtomId}` : "none");
  };

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
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
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
    if (pendingAtom) symbolInputRef.current?.focus();
  }, [pendingAtom]);

  useEffect(() => {
    if (pendingAtom) return;
    targetRefs.current.get(focusedTargetKey)?.focus({ preventScroll: true });
  }, [focusedTargetKey, pendingAtom, visibleSlots.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return;

      if (event.key === "Escape") {
        if (pendingAtom) {
          cancelPendingAtom();
        } else if (focusedSlot && event.target instanceof Element && event.target.matches(".direction-slot")) {
          focusTarget(`atom:${focusedSlot.parentId}`);
        } else {
          beginClose();
        }
        return;
      }

      if (pendingAtom) return;
      const isCanvasTarget = event.target instanceof Element
        && event.target.matches(".atom-node, .direction-slot, .initial-atom");

      const direction = EDITOR_DIRECTIONS.find(({ key }) => `Arrow${key[0].toUpperCase()}${key.slice(1)}` === event.key);
      if (direction) {
        if (!isCanvasTarget) return;
        event.preventDefault();
        const targets: NavigationTarget[] = [
          ...atoms.map((atom) => ({ key: `atom:${atom.id}`, kind: "atom" as const, x: atom.x, y: atom.y })),
          ...visibleSlots.map((slot) => ({ key: slot.key, kind: "slot" as const, x: slot.x, y: slot.y })),
        ];
        const current = targets.find((target) => target.key === focusedTargetKey)
          ?? targets.find((target) => target.key === `atom:${selectedAtomId}`)
          ?? targets[0];
        if (!current) return;
        const next = nextNavigationTarget(current, targets, direction);
        if (next) focusTarget(next.key);
        return;
      }

      if (event.key === "Enter" && focusedSlot && isCanvasTarget) {
        event.preventDefault();
        startSlotEntry(focusedSlot);
        return;
      }

      if (event.key === "Enter" && atoms.length === 0 && isCanvasTarget) {
        event.preventDefault();
        setPendingAtom({ x: 0, y: 0 });
        setSymbol("");
        setValidationError(null);
        return;
      }

      if (/^[a-z]$/i.test(event.key) && isCanvasTarget) {
        event.preventDefault();
        const initialSymbol = normalizeSymbol(event.key);
        if (focusedSlot) {
          startSlotEntry(focusedSlot, initialSymbol);
          return;
        }
        if (focusedAtomId) {
          const atom = atoms.find((candidate) => candidate.id === focusedAtomId);
          if (atom) startAtom({ x: atom.x, y: atom.y, atomId: atom.id }, initialSymbol);
          return;
        }
        if (atoms.length === 0) startAtom({ x: 0, y: 0 }, initialSymbol);
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete")
        && selectedAtomId
        && event.target instanceof Element
        && event.target.closest(".atom-node")
      ) {
        event.preventDefault();
        const remainingAtoms = atoms.filter((atom) => atom.id !== selectedAtomId);
        const nextAtomId = remainingAtoms[0]?.id ?? null;
        setAtoms(remainingAtoms);
        setBonds((current) => current.filter((bond) => bond.from !== selectedAtomId && bond.to !== selectedAtomId));
        setSelectedAtomId(nextAtomId);
        setHoveredAtomId(null);
        setFocusedTargetKey(nextAtomId ? `atom:${nextAtomId}` : "initial");
        setValidationError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atoms, beginClose, focusedSlot, focusedTargetKey, pendingAtom, selectedAtomId, visibleSlots]);

  useEffect(() => {
    if (!pendingAtom || !symbol) {
      setValidationError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const candidate = {
        id: pendingAtom.atomId ?? "pending-atom",
        symbol,
        x: pendingAtom.x,
        y: pendingAtom.y,
        formalCharge: atoms.find((atom) => atom.id === pendingAtom.atomId)?.formalCharge ?? 0,
        implicitHydrogens: 0,
      };
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

  const commitAtom = async () => {
    if (!pendingAtom || !symbol || isValidating) return;
    const atom: Atom = {
      id: pendingAtom.atomId ?? crypto.randomUUID(),
      symbol,
      x: pendingAtom.x,
      y: pendingAtom.y,
      formalCharge: atoms.find((atom) => atom.id === pendingAtom.atomId)?.formalCharge ?? 0,
      implicitHydrogens: 0,
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
    setFocusedTargetKey(`atom:${atom.id}`);
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
      charge: atoms.reduce((total, atom) => total + atom.formalCharge, 0),
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
                const directionX = deltaX / length;
                const directionY = deltaY / length;
                const normalX = -deltaY / length;
                const normalY = deltaX / length;
                const trimFrom = Math.abs(directionX) * (from.symbol.length * 6 + 8) + Math.abs(directionY) * 16;
                const trimTo = Math.abs(directionX) * (to.symbol.length * 6 + 8) + Math.abs(directionY) * 16;
                const lineStart = {
                  x: fromPosition.left + directionX * trimFrom,
                  y: fromPosition.top + directionY * trimFrom,
                };
                const lineEnd = {
                  x: toPosition.left - directionX * trimTo,
                  y: toPosition.top - directionY * trimTo,
                };
                const orderName = bond.order === 1 ? "single" : bond.order === 2 ? "double" : "triple";
                const cycleBond = () => cycleBondOrder(bond);
                return (
                  <g
                    key={`${bond.from}-${bond.to}`}
                    className="bond-control"
                    role="button"
                    tabIndex={pendingAtom ? -1 : 0}
                    aria-disabled={Boolean(pendingAtom)}
                    aria-label={`${orderName} bond from ${from.symbol} to ${to.symbol}. Activate to change bond order.`}
                    onClick={() => {
                      if (!pendingAtom) cycleBond();
                    }}
                    onKeyDown={(event) => {
                      if (!pendingAtom && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        event.stopPropagation();
                        cycleBond();
                      }
                    }}
                  >
                    <line
                      className="bond-hit-area"
                      x1={lineStart.x}
                      y1={lineStart.y}
                      x2={lineEnd.x}
                      y2={lineEnd.y}
                    />
                    {BOND_LINE_OFFSETS[bond.order].map((offset) => (
                      <line
                        className="bond-stroke"
                        key={offset}
                        x1={lineStart.x + normalX * offset}
                        y1={lineStart.y + normalY * offset}
                        x2={lineEnd.x + normalX * offset}
                        y2={lineEnd.y + normalY * offset}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {atoms.filter((atom) => atom.id !== pendingAtom?.atomId).map((atom) => (
              <button
                key={atom.id}
                ref={registerTarget(`atom:${atom.id}`)}
                type="button"
                disabled={Boolean(pendingAtom)}
                className={`atom-node${selectedAtomId === atom.id ? " atom-node--selected" : ""}${focusedTargetKey === `atom:${atom.id}` ? " atom-node--focused" : ""}`}
                style={editorPosition(atom.x, atom.y)}
                aria-label={`${atom.symbol} atom${atom.formalCharge ? `, formal charge ${atom.formalCharge}` : ""}. Select to show free bonding slots; double-click to edit the element.`}
                aria-pressed={selectedAtomId === atom.id}
                onClick={() => {
                  setSelectedAtomId(atom.id);
                  setFocusedTargetKey(`atom:${atom.id}`);
                }}
                onDoubleClick={() => startAtom({ x: atom.x, y: atom.y, atomId: atom.id }, atom.symbol)}
                onFocus={() => focusTarget(`atom:${atom.id}`)}
                onPointerEnter={() => {
                  if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
                  setHoveredAtomId(atom.id);
                }}
                onPointerLeave={() => {
                  hoverTimerRef.current = window.setTimeout(() => {
                    setHoveredAtomId((current) => current === atom.id ? null : current);
                  }, 140);
                }}
              >
                <span>{atom.symbol}</span>
                {atom.formalCharge !== 0 && (
                  <sup style={{ "--charge-offset": `${atom.symbol.length * 6 + 3}px` } as React.CSSProperties}>
                    {formatFormalCharge(atom.formalCharge)}
                  </sup>
                )}
              </button>
            ))}

            {slotParent && visibleSlots.map((slot) => (
              <button
                key={slot.key}
                ref={registerTarget(slot.key)}
                type="button"
                className={`direction-slot${focusedTargetKey === slot.key ? " direction-slot--focused" : ""}`}
                style={editorPosition(slot.x, slot.y)}
                aria-label={`Add atom ${slot.direction.label} ${slotParent.symbol}`}
                onClick={() => startSlotEntry(slot)}
                onFocus={() => focusTarget(slot.key)}
                onPointerEnter={() => {
                  if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
                  setHoveredAtomId(slot.parentId);
                }}
                onPointerLeave={() => {
                  hoverTimerRef.current = window.setTimeout(() => setHoveredAtomId(null), 140);
                }}
              >
              </button>
            ))}

            {atoms.length === 0 && !pendingAtom && (
              <button
                ref={registerTarget("initial")}
                type="button"
                className={`initial-atom${focusedTargetKey === "initial" ? " initial-atom--focused" : ""}`}
                style={editorPosition(0, 0)}
                aria-label="Add the first atom"
                onClick={() => startAtom({ x: 0, y: 0 })}
                onFocus={() => setFocusedTargetKey("initial")}
              />
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
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitAtom();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelPendingAtom();
                    }
                  }}
                />
                <span>Enter to place</span>
              </div>
            )}
          </div>
        </div>

        <footer className="editor-footer">
          {selectedAtom && !pendingAtom && (
            <div className="atom-charge-control">
              <span>{selectedAtom.symbol} formal charge: {selectedAtom.formalCharge}</span>
              {[-1, 1].map((amount) => (
                <button type="button" key={amount} disabled={isValidating}
                  aria-label={amount < 0 ? "Decrease atom formal charge" : "Increase atom formal charge"}
                  onClick={() => {
                    setAtoms((current) => current.map((atom) => atom.id === selectedAtom.id
                      ? { ...atom, formalCharge: atom.formalCharge + amount } : atom));
                    setValidationError(null);
                  }}>{amount < 0 ? "−" : "+"}</button>
              ))}
            </div>
          )}
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
  const [analysis, setAnalysis] = useState<ReactionAnalysisResult | null>(null);
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
    setAnalysis(null);
    setRunError(null);
    setEditorState(null);
  }, []);

  const selectMolecule = (molecule: Molecule) => {
    setSelectedMoleculeId(molecule.id);
    setRunError(null);
  };

  const removeMolecule = (side: Side, moleculeId: string) => {
    setMolecules((current) => ({
      ...current,
      [side]: current[side].filter((molecule) => molecule.id !== moleculeId),
    }));
    if (selectedMoleculeId === moleculeId) setSelectedMoleculeId(null);
    setAnalysis(null);
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
      setAnalysis(await requestReactionAnalysis(molecules));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The reaction could not be analyzed.");
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
      async execute(input) {
        const candidate = input as { side?: unknown; elements?: unknown; charge?: unknown };
        if (candidate.side !== "reactants" && candidate.side !== "products") throw new Error("Side must be reactants or products.");
        if (!Array.isArray(candidate.elements) || candidate.elements.length === 0) throw new Error("At least one element shorthand is required.");
        const side: Side = candidate.side;
        const elements = candidate.elements.map((value) => normalizeSymbol(String(value)));
        if (elements.some((value) => !value)) throw new Error("Each shorthand must contain one or two letters.");
        const charge = typeof candidate.charge === "number" && Number.isInteger(candidate.charge) ? candidate.charge : 0;
        const draft = moleculeFromSymbols(elements, charge);
        if (charge !== 0 && draft.atoms.length > 1) throw new Error("Set charges on individual atoms in the molecule editor.");
        draft.atoms[0].formalCharge = charge;
        const result = await validateCompletedMolecule(draft);
        if (!result.valid || !result.molecule) throw new Error(result.errors.join(" "));
        const molecule = fromApiMolecule(result.molecule);
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
        {analysis && <ElectronFlow molecules={molecules.reactants} flow={analysis.electron_flow} />}
        {analysis && <BondDiffsPanel diff={analysis.bond_diffs} molecules={molecules} />}
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
