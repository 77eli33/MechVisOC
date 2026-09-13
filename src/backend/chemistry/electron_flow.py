"""Conservative pair tracking over already qualified sources and sinks.

Shared atoms define structural candidates, not proof of a chemical mechanism.
Only single-candidate constraints are resolved; unresolved feasible graphs are
reported as ambiguous. No arrow coordinates or frontend assumptions enter here.
"""

from collections import deque
from dataclasses import dataclass
from typing import Literal

from .electron_balance import PairBalance, PairSite


@dataclass(frozen=True)
class PairFlow:
    source: PairSite
    sink: PairSite
    pair_count: int


@dataclass(frozen=True)
class FlowResult:
    status: Literal["complete", "ambiguous", "conflict"]
    flows: tuple[PairFlow, ...]
    remaining: PairBalance
    candidates: tuple[tuple[int, int], ...]
    reason: str | None = None


def _can_balance(source_counts, sink_counts, edges):
    """Capacity feasibility check, without selecting a reported mechanism."""
    if sum(source_counts) != sum(sink_counts):
        return False
    start, end = ("start", 0), ("end", 0)
    residual = {}

    def connect(a, b, capacity):
        residual.setdefault(a, {})[b] = capacity
        residual.setdefault(b, {})[a] = 0

    for i, count in enumerate(source_counts):
        connect(start, ("source", i), count)
    for j, count in enumerate(sink_counts):
        connect(("sink", j), end, count)
    for i, j in edges:
        connect(("source", i), ("sink", j), min(source_counts[i], sink_counts[j]))
    total = 0
    while True:
        parents = {start: None}
        queue = deque([start])
        while queue and end not in parents:
            node = queue.popleft()
            for target, capacity in residual.get(node, {}).items():
                if capacity > 0 and target not in parents:
                    parents[target] = node
                    queue.append(target)
        if end not in parents:
            return total == sum(source_counts)
        amount = sum(source_counts)
        node = end
        while parents[node] is not None:
            previous = parents[node]
            amount = min(amount, residual[previous][node])
            node = previous
        node = end
        while parents[node] is not None:
            previous = parents[node]
            residual[previous][node] -= amount
            residual[node][previous] += amount
            node = previous
        total += amount


def track_electron_pairs(balance: PairBalance) -> FlowResult:
    """Match classified sites without deriving charges or reclassifying sites.

    Candidate indices in the result refer to ``remaining.sources/sinks``.
    A complete result balances every site; this is not mechanism uniqueness
    beyond the chosen atom mapping and shared-atom candidate rule.
    """
    for sites in (balance.sources, balance.sinks):
        if len({site.atoms for site in sites}) != len(sites):
            raise ValueError("Duplicate pair locations must be combined before tracking")
    source_counts = [site.pair_count for site in balance.sources]
    sink_counts = [site.pair_count for site in balance.sinks]
    edges = tuple((i, j) for i, source in enumerate(balance.sources)
                  for j, sink in enumerate(balance.sinks)
                  if set(source.atoms) & set(sink.atoms))
    if not _can_balance(source_counts, sink_counts, edges):
        return FlowResult("conflict", (), balance, edges,
                          "No capacity-respecting assignment balances all sources and sinks")

    flows = []
    while True:
        active = [(i, j) for i, j in edges if source_counts[i] and sink_counts[j]]
        forced = None
        for i, count in enumerate(source_counts):
            options = [j for source, j in active if source == i]
            if count and len(options) == 1:
                forced = i, options[0], count
                break
        if forced is None:
            for j, count in enumerate(sink_counts):
                options = [i for i, sink in active if sink == j]
                if count and len(options) == 1:
                    forced = options[0], j, count
                    break
        if forced is None:
            break
        i, j, count = forced
        # Feasibility above guarantees a sole candidate can absorb the entire
        # constrained site's capacity; taking min() would hide contradictions.
        if count > source_counts[i] or count > sink_counts[j]:
            raise RuntimeError("Forced assignment violated checked pair capacities")
        flows.append(PairFlow(balance.sources[i], balance.sinks[j], count))
        source_counts[i] -= count
        sink_counts[j] -= count

    source_indices = [i for i, count in enumerate(source_counts) if count]
    sink_indices = [j for j, count in enumerate(sink_counts) if count]
    remaining = PairBalance(
        tuple(PairSite(balance.sources[i].atoms, source_counts[i]) for i in source_indices),
        tuple(PairSite(balance.sinks[j].atoms, sink_counts[j]) for j in sink_indices),
    )
    candidates = tuple((source_indices.index(i), sink_indices.index(j))
                       for i, j in active)
    status = "ambiguous" if source_indices else "complete"
    return FlowResult(status, tuple(flows), remaining, candidates)
