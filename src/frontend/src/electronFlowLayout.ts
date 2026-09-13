/** Presentation geometry only. Pair classification and tracking come from the API. */
export type Point = { x: number; y: number };
export type AtomRef = { molecule_id: string; atom_id: string };
export type FlowAtom = Point & { id: string; symbol: string; formalCharge: number };
export type FlowMolecule = { id: string; atoms: FlowAtom[]; bonds: { from: string; to: string; order: number }[] };
export type PairSite = { atoms: AtomRef[]; pair_count: number };
export type PairFlow = { source: PairSite; sink: PairSite; pair_count: number };
export type ElectronFlow = {
  status: "complete" | "ambiguous" | "conflict";
  sources: PairSite[]; sinks: PairSite[]; flows: PairFlow[];
  remaining: { sources: PairSite[]; sinks: PairSite[] };
  candidates: number[][]; reason: string | null;
};
export type PlacedAtom = FlowAtom & { moleculeId: string };
export type Placement = { molecule: FlowMolecule; atoms: PlacedAtom[] };
export type Port = Point & { normal: Point };
export type Curve = { source: Port; sink: Port; c1: Point; c2: Point; flow: PairFlow };
export const STEP = 80;
export const refKey = (ref: AtomRef) => JSON.stringify([ref.molecule_id, ref.atom_id]);
export const siteKey = (site: PairSite) => site.atoms.map(refKey).sort().join("|");
export const atomKey = (atom: PlacedAtom) => refKey({ molecule_id: atom.moleculeId, atom_id: atom.id });
const directions: Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const add = (a: Point, b: Point, scale = 1): Point => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function bounds(points: Point[], pad = 0) {
  const values = points.length ? points : [{ x: 0, y: 0 }];
  return { minX: Math.min(...values.map(p => p.x)) - pad, minY: Math.min(...values.map(p => p.y)) - pad,
    maxX: Math.max(...values.map(p => p.x)) + pad, maxY: Math.max(...values.map(p => p.y)) + pad };
}
function rotated(molecule: FlowMolecule, turns: number): PlacedAtom[] {
  const origin = molecule.atoms[0] ?? { x: 0, y: 0 };
  return molecule.atoms.map(atom => {
    let x = (atom.x - origin.x) * STEP, y = (atom.y - origin.y) * STEP;
    for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    return { ...atom, x, y, moleculeId: molecule.id };
  });
}
export function layoutMolecules(molecules: FlowMolecule[], balance: ElectronFlow): Placement[] {
  for (const molecule of molecules) for (const bond of molecule.bonds) {
    const a = molecule.atoms.find(a => a.id === bond.from)!;
    const b = molecule.atoms.find(a => a.id === bond.to)!;
    if (!a || !b || (a.x !== b.x && a.y !== b.y) || (a.x === b.x && a.y === b.y)) {
      throw new Error("Existing bonds need distinct horizontal or vertical atom positions. Adjust the molecule in the editor.");
    }
  }
  const involved = new Set([...balance.sources, ...balance.sinks].flatMap(s => s.atoms.map(refKey)));
  const count = (m: FlowMolecule) => m.atoms.filter(a => involved.has(refKey({ molecule_id: m.id, atom_id: a.id }))).length;
  const queue = [...molecules].sort((a, b) => count(b) - count(a) || b.atoms.length - a.atoms.length);
  const placed: Placement[] = [];
  const contacts = balance.sinks.filter(s => s.atoms.length === 2 && s.atoms[0].molecule_id !== s.atoms[1].molecule_id);
  while (queue.length) {
    // Prefer partners of the already placed component before disconnected spectators.
    const index = queue.findIndex(m => contacts.some(s => s.atoms.some(a => a.molecule_id === m.id) && s.atoms.some(a => placed.some(p => p.molecule.id === a.molecule_id))));
    const molecule = queue.splice(Math.max(index, 0), 1)[0];
    if (!placed.length) { placed.push({ molecule, atoms: rotated(molecule, 0) }); continue; }
    const existing = placed.flatMap(p => p.atoms);
    const byRef = new Map(existing.map(a => [atomKey(a), a]));
    const links = contacts.flatMap(s => {
      const mine = s.atoms.find(a => a.molecule_id === molecule.id);
      const other = s.atoms.find(a => byRef.has(refKey(a)));
      return mine && other ? [{ mine, other: byRef.get(refKey(other))! }] : [];
    });
    let best: { score: number; atoms: PlacedAtom[] } | undefined;
    for (let turn = 0; turn < 4; turn++) {
      const local = rotated(molecule, turn);
      const attachments = links.length ? links : [{ mine: { molecule_id: molecule.id, atom_id: local[0].id }, other: { x: Math.max(...existing.map(a => a.x)) + STEP, y: 0 } }];
      for (const link of attachments) for (const direction of directions) for (const gap of [1, 2, 3, 4, 6, 8]) {
        const mine = local.find(a => a.id === link.mine.atom_id)!;
        const target = add(link.other, direction, STEP * gap);
        const atoms = local.map(a => ({ ...a, x: a.x + target.x - mine.x, y: a.y + target.y - mine.y }));
        const box = bounds(atoms), priorBoxes = placed.map(p => bounds(p.atoms));
        const overlap = priorBoxes.some(b => box.minX < b.maxX + 42 && box.maxX > b.minX - 42 && box.minY < b.maxY + 42 && box.maxY > b.minY - 42);
        const near = atoms.reduce((sum, a) => sum + existing.reduce((s, b) => s + Math.max(0, 65 - distance(a, b)) ** 2, 0), 0);
        const score = (overlap ? 1e7 : 0) + near * 1000 + links.reduce((sum, l) => {
          const a = atoms.find(a => a.id === l.mine.atom_id)!;
          const obstructed = [...existing, ...atoms].some(obstacle =>
            atomKey(obstacle) !== atomKey(a) && atomKey(obstacle) !== atomKey(l.other) && segmentDistance(obstacle, a, l.other) < 28);
          const crossingBond = [...placed, { molecule, atoms }].some(p => p.molecule.bonds.some(b => {
            const start = p.atoms.find(atom => atom.id === b.from)!, end = p.atoms.find(atom => atom.id === b.to)!;
            // Shared endpoints are expected; unrelated bond interiors must stay clear.
            if ([start, end].some(atom => atomKey(atom) === atomKey(a) || atomKey(atom) === atomKey(l.other))) return false;
            return Array.from({ length: 19 }, (_, i) => add(start, { x: end.x - start.x, y: end.y - start.y }, (i + 1) / 20)).some(point => segmentDistance(point, a, l.other) < 10);
          }));
          return sum + (obstructed || crossingBond ? 1e8 : 0) + distance(a, l.other) + (a.x !== l.other.x && a.y !== l.other.y ? 2000 : 0);
        }, links.length ? 0 : distance(atoms[0], attachments[0].other)) + turn * .01;
        if (!best || score < best.score) best = { score, atoms };
      }
    }
    placed.push({ molecule, atoms: best!.atoms });
  }
  return placed;
}
export function sitePorts(site: PairSite, atoms: Map<string, PlacedAtom>, placements: Placement[] = []): Port[] {
  const a = atoms.get(refKey(site.atoms[0]))!;
  if (site.atoms.length === 1) {
    const molecule = placements.find(p => p.molecule.id === a.moleculeId)?.molecule;
    const neighbors = (molecule?.bonds ?? []).flatMap(b => {
      const id = b.from === a.id ? b.to : b.to === a.id ? b.from : null;
      return id ? [atoms.get(refKey({ molecule_id: a.moleculeId, atom_id: id }))!] : [];
    });
    const free = directions.filter(n => !neighbors.some(b => (b.x - a.x) * n.x + (b.y - a.y) * n.y > 0 && Math.abs((b.x - a.x) * n.y - (b.y - a.y) * n.x) < .01));
    // Four occupied ports require a visible fallback; avoid hiding the source.
    return (free.length ? free : directions).map(normal => ({ ...add(a, normal, normal.x ? a.symbol.length * 6 + 17 : 25), normal }));
  }
  const b = atoms.get(refKey(site.atoms[1]))!;
  const length = distance(a, b) || 1;
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  return [normal, { x: -normal.x, y: -normal.y }].map(normal => ({ ...add(midpoint, normal, 12), normal }));
}
export function curvePoint(curve: Curve, t: number): Point {
  const u = 1 - t;
  return { x: u ** 3 * curve.source.x + 3 * u * u * t * curve.c1.x + 3 * u * t * t * curve.c2.x + t ** 3 * curve.sink.x,
    y: u ** 3 * curve.source.y + 3 * u * u * t * curve.c1.y + 3 * u * t * t * curve.c2.y + t ** 3 * curve.sink.y };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}
export function makeCurves(flow: ElectronFlow, atoms: Map<string, PlacedAtom>, placements: Placement[] = []): Curve[] {
  if (flow.status === "conflict") return [];
  const curves: Curve[] = [];
  const bonds = placements.flatMap(p => p.molecule.bonds.map(b => [
    atoms.get(refKey({ molecule_id: p.molecule.id, atom_id: b.from }))!,
    atoms.get(refKey({ molecule_id: p.molecule.id, atom_id: b.to }))!,
  ]));
  for (const site of flow.sinks.filter(site => site.atoms.length === 2)) {
    bonds.push(site.atoms.map(ref => atoms.get(refKey(ref))!));
  }
  for (const movement of flow.flows.flatMap(m => Array.from({ length: m.pair_count }, () => ({ ...m, pair_count: 1 })))) {
    let best: { score: number; curve: Curve } | undefined;
    for (const source of sitePorts(movement.source, atoms, placements)) for (const sink of sitePorts(movement.sink, atoms, placements)) for (const bend of [24, 40, 60]) {
      const reach = Math.max(bend, distance(source, sink) * .35);
      const curve = { source, sink, c1: add(source, source.normal, reach), c2: add(sink, sink.normal, reach), flow: movement };
      const samples = Array.from({ length: 19 }, (_, i) => curvePoint(curve, (i + 1) / 20));
      let score = distance(source, sink) + reach * .15;
      for (const p of samples) {
        for (const atom of atoms.values()) score += Math.max(0, 22 - distance(p, atom)) ** 2 * 30;
        for (const [a, b] of bonds) score += Math.max(0, 8 - segmentDistance(p, a, b)) ** 2 * 30;
        for (const prior of curves) for (let i = 1; i < 20; i++) score += Math.max(0, 10 - distance(p, curvePoint(prior, i / 20))) * 3;
      }
      if (!best || score < best.score) best = { score, curve };
    }
    curves.push(best!.curve);
  }
  return curves;
}
export function fitScene(points: Point[], width: number, height: number) {
  const box = bounds(points, 48);
  const sceneWidth = box.maxX - box.minX, sceneHeight = box.maxY - box.minY;
  const canvasWidth = Math.max(width, sceneWidth), canvasHeight = Math.max(height, sceneHeight);
  return { width: canvasWidth, height: canvasHeight, x: (canvasWidth - sceneWidth) / 2 - box.minX, y: (canvasHeight - sceneHeight) / 2 - box.minY };
}
