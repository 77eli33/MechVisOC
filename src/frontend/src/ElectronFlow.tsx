import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  atomKey, bounds, fitScene, layoutMolecules, makeCurves, refKey, siteKey, sitePorts, STEP,
  type ElectronFlow as FlowData, type FlowMolecule, type PairSite, type Point, type Port,
} from "./electronFlowLayout";

const SOURCE = "#e5a2a6";
const SINK = "#b1dfb1";
const WHITE = "#fff";
const offsets = (order: number) => order === 1 ? [0] : order === 2 ? [-3, 3] : [-6, 0, 6];

/** The scene consumes backend sites; it never infers chemistry from UI charges. */
export default function ElectronFlow({ molecules, flow }: { molecules: FlowMolecule[]; flow: FlowData }) {
  const markerId = useId().replace(/:/g, "");
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 430 });
  const [moves, setMoves] = useState<Record<string, Point>>({});
  const drag = useRef<{ id: string; start: Point; original: Point } | null>(null);
  useEffect(() => { setMoves({}); }, [molecules, flow]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => {
    try { return { placements: layoutMolecules(molecules, flow), error: null }; }
    catch (error) { return { placements: [], error: error instanceof Error ? error.message : "The structures could not be arranged." }; }
  }, [molecules, flow]);
  const placements = layout.placements.map(p => ({ ...p, atoms: p.atoms.map(a => ({ ...a, x: a.x + (moves[p.molecule.id]?.x ?? 0), y: a.y + (moves[p.molecule.id]?.y ?? 0) })) }));
  const atoms = new Map(placements.flatMap(p => p.atoms.map(a => [atomKey(a), a] as const)));
  const curves = makeCurves(layout.error ? { ...flow, flows: [] } : flow, atoms, placements);
  const pairs: { site: PairSite; role: string; port: Port }[] = [];
  if (!layout.error) for (const role of ["source", "sink"] as const) {
    for (const site of role === "source" ? flow.sources : flow.sinks) {
      if (site.atoms.length !== 1) continue;
      let unassigned = site.pair_count;
      for (const curve of curves.filter(c => siteKey(c.flow[role]) === siteKey(site))) {
        pairs.push({ site: { ...site, pair_count: curve.flow.pair_count }, role, port: curve[role] });
        unassigned -= curve.flow.pair_count;
      }
      if (unassigned > 0) pairs.push({ site: { ...site, pair_count: unassigned }, role, port: sitePorts(site, atoms, placements)[0] });
    }
  }
  const groupedPairs = new Map<string, (typeof pairs)[number]>();
  for (const pair of pairs) {
    const key = `${pair.role}:${siteKey(pair.site)}:${pair.port.x}:${pair.port.y}`;
    const previous = groupedPairs.get(key);
    groupedPairs.set(key, previous ? { ...pair, site: { ...pair.site, pair_count: previous.site.pair_count + pair.site.pair_count } } : pair);
  }
  // Auto-center the initial scene only. User moves remain absolute scene offsets.
  const initialFit = useMemo(() => {
    const initialAtoms = new Map(layout.placements.flatMap(p => p.atoms.map(a => [atomKey(a), a] as const)));
    const initialCurves = makeCurves(layout.error ? { ...flow, flows: [] } : flow, initialAtoms, layout.placements);
    return fitScene([...initialAtoms.values(), ...initialCurves.flatMap(c => [c.source, c.sink, c.c1, c.c2])], size.width, size.height);
  }, [layout, flow, size]);
  const box = bounds([...atoms.values(), ...curves.flatMap(c => [c.source, c.sink, c.c1, c.c2]), ...pairs.map(p => p.port)], 48);
  const fit = { ...initialFit, x: Math.max(initialFit.x, -box.minX), y: Math.max(initialFit.y, -box.minY) };
  fit.width = Math.max(initialFit.width, box.maxX + fit.x);
  fit.height = Math.max(initialFit.height, box.maxY + fit.y);
  const previousOrigin = useRef({ x: fit.x, y: fit.y });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element && drag.current) {
      element.scrollLeft += fit.x - previousOrigin.current.x;
      element.scrollTop += fit.y - previousOrigin.current.y;
    }
    previousOrigin.current = { x: fit.x, y: fit.y };
  }, [fit.x, fit.y]);
  const sourceByKey = new Map(flow.sources.map(site => [siteKey(site), site]));
  const sinkByKey = new Map(flow.sinks.map(site => [siteKey(site), site]));
  const existingBonds = new Set(placements.flatMap(p => p.molecule.bonds.map(b => siteKey({ atoms: [{ molecule_id: p.molecule.id, atom_id: b.from }, { molecule_id: p.molecule.id, atom_id: b.to }], pair_count: b.order }))));
  const line = (site: PairSite, offset: number, color: string, dashed = false, key = "") => {
    const a = atoms.get(refKey(site.atoms[0]))!, b = atoms.get(refKey(site.atoms[1]))!;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
    const trimA = Math.abs(dx) * (a.symbol.length * 6 + 8) + Math.abs(dy) * 16;
    const trimB = Math.abs(dx) * (b.symbol.length * 6 + 8) + Math.abs(dy) * 16;
    return <line key={key} x1={a.x + dx * trimA - dy * offset} y1={a.y + dy * trimA + dx * offset} x2={b.x - dx * trimB - dy * offset} y2={b.y - dy * trimB + dx * offset} stroke={color} strokeDasharray={dashed ? "2 4" : undefined} />;
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const { id, start, original } = drag.current;
    setMoves(current => ({ ...current, [id]: { x: original.x + Math.round((event.clientX - start.x) / STEP) * STEP, y: original.y + Math.round((event.clientY - start.y) / STEP) * STEP } }));
  };
  return <section className="molecule-panel electron-flow-panel" aria-labelledby="electron-flow-title">
    <header className="panel-heading"><h2 id="electron-flow-title">Electron Flow</h2></header>
    {layout.error ? <p className="electron-flow-notice" role="status">{layout.error}</p> : flow.status !== "complete" && <p className="electron-flow-notice" role="status">{flow.status === "conflict" ? "The electron-pair balance is inconsistent. No arrows are shown." : "Some electron movements are ambiguous. Only resolved arrows are shown."}</p>}
    <div className="electron-flow-viewport" ref={viewport} tabIndex={0} aria-label="Electron flow workspace. Scroll for large structures.">
      <svg width={fit.width} height={fit.height} className="electron-flow-scene" aria-label="One reaction step with electron-pair arrows" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <defs><marker id={markerId} markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></marker></defs>
        <g transform={`translate(${fit.x} ${fit.y})`}>
          {placements.map(p => <g key={p.molecule.id} className="electron-flow-molecule" role="group" aria-label={`Molecule ${p.molecule.id}. Drag to reposition.`} onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
            drag.current = { id: p.molecule.id, start: { x: event.clientX, y: event.clientY }, original: moves[p.molecule.id] ?? { x: 0, y: 0 } };
          }}>
            {p.molecule.bonds.flatMap(b => {
              const site = { atoms: [{ molecule_id: p.molecule.id, atom_id: b.from }, { molecule_id: p.molecule.id, atom_id: b.to }], pair_count: b.order };
              const removed = sourceByKey.get(siteKey(site))?.pair_count ?? 0;
              const added = sinkByKey.get(siteKey(site))?.pair_count ?? 0;
              return [...offsets(b.order).map((offset, index) => line(site, offset, index >= b.order - removed ? SOURCE : WHITE, false, `${b.from}-${b.to}-${index}`)), ...Array.from({ length: added }, (_, i) => line(site, 7 + i * 6, SINK, true, `${b.from}-${b.to}-added-${i}`))];
            })}
            {p.atoms.map(a => <g key={a.id}><rect x={a.x - 22} y={a.y - 25} width="44" height="50" fill="transparent" stroke="none" /><text x={a.x} y={a.y} textAnchor="middle" dominantBaseline="central">{a.symbol}</text>{a.formalCharge !== 0 && <text className="electron-flow-charge" x={a.x + a.symbol.length * 6 + 3} y={a.y - 10}>{Math.abs(a.formalCharge) > 1 ? Math.abs(a.formalCharge) : ""}{a.formalCharge > 0 ? "+" : "−"}</text>}</g>)}
          </g>)}
          {!layout.error && flow.sinks.filter(site => site.atoms.length === 2 && !existingBonds.has(siteKey(site))).flatMap(site => offsets(site.pair_count).map((offset, i) => line(site, offset, SINK, true, `${siteKey(site)}-${i}`)))}
          {[...groupedPairs.values()].flatMap(({ site, role, port }, locationIndex) => Array.from({ length: site.pair_count }, (_, pairIndex) => [-1, 1].map(sign => {
            const side = (pairIndex - (site.pair_count - 1) / 2) * 12 + sign * 3;
            return <circle key={`${role}-${siteKey(site)}-${locationIndex}-${pairIndex}-${sign}`} cx={port.x - port.normal.x * 6 - port.normal.y * side} cy={port.y - port.normal.y * 6 + port.normal.x * side} r="2" stroke="none" fill={role === "source" ? SOURCE : SINK} />;
          })))}
          {curves.map((curve, index) => <path key={index} className="electron-flow-arrow" d={`M${curve.source.x},${curve.source.y} C${curve.c1.x},${curve.c1.y} ${curve.c2.x},${curve.c2.y} ${curve.sink.x},${curve.sink.y}`} markerEnd={`url(#${markerId})`}><title>{curve.flow.pair_count} electron {curve.flow.pair_count === 1 ? "pair" : "pairs"}</title></path>)}
        </g>
      </svg>
    </div>
  </section>;
}
