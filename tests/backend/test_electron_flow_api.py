"""Transport coverage for explicit-H electron flow, separate from legacy mapping."""

import pytest
from fastapi.testclient import TestClient

from src.backend import main
from src.backend.chemistry.electron_balance import PairBalance, PairSite
from src.backend.chemistry.electron_flow import track_electron_pairs
from src.backend.chemistry.model import AtomRef
from src.backend.electron_flow_api import serialize_electron_flow
from test_electron_flow import protonation

client = TestClient(main.app)


def reaction_payload():
    before, after = protonation()

    def side_payload(side):
        return {"molecules": [
            {"id": m.molecule_id, "name": m.name, "charge": m.charge,
             "atoms": [{"id": a.id, "element": a.element, "formal_charge": a.formal_charge,
                        "x": i, "y": 0} for i, a in enumerate(m.atoms)],
             "bonds": [{"atom1_id": b.atom1_id, "atom2_id": b.atom2_id, "order": b.order}
                       for b in m.bonds]}
            for m in side.molecules]}

    return {"reactants": side_payload(before), "products": side_payload(after)}


def test_protonation_api_reuses_mapping_and_returns_reactant_locations(monkeypatch):
    original = main.map_atoms
    calls = []

    def counted(*args):
        calls.append(args)
        return original(*args)

    monkeypatch.setattr(main, "map_atoms", counted)
    payload = reaction_payload()
    response = client.post("/api/electron-flow", json=payload)
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    body = response.json()
    assert body["reactants"] == payload["reactants"]
    flow = body["electron_flow"]
    assert flow["status"] == "complete"
    assert flow["reason"] is None
    assert flow["remaining"] == {"sources": [], "sinks": []}
    assert flow["candidates"] == []

    def location(site):
        return frozenset((a["molecule_id"], a["atom_id"]) for a in site["atoms"])

    assert {(location(f["source"]), location(f["sink"]), f["pair_count"]) for f in flow["flows"]} == {
        (frozenset({("ethene", "c1"), ("ethene", "c2")}),
         frozenset({("ethene", "c1"), ("acid", "h")}), 1),
        (frozenset({("acid", "h"), ("acid", "br")}), frozenset({("acid", "br")}), 1),
    }
    assert len(body["bond_diffs"]["order_changed"]) == 1


def test_electron_flow_odd_electrons_are_422_without_breaking_legacy_mapping():
    molecule = {"id": "m", "atoms": [
        {"id": "c", "element": "C", "x": 0, "y": 0},
        {"id": "o", "element": "O", "x": 1, "y": 0}],
        "bonds": [{"atom1_id": "c", "atom2_id": "o", "order": 1}]}
    payload = {"reactants": {"molecules": [molecule]}, "products": {"molecules": [molecule]}}
    assert client.post("/api/atom-mapping", json=payload).status_code == 200
    response = client.post("/api/electron-flow", json=payload)
    assert response.status_code == 422
    assert "odd nonbonding" in response.json()["detail"]


def test_electron_flow_rejects_nonconserved_reaction():
    payload = reaction_payload()
    payload["products"]["molecules"].pop()
    response = client.post("/api/electron-flow", json=payload)
    assert response.status_code == 422
    assert "Invalid Reaction" in response.json()["detail"]


@pytest.mark.parametrize("conflict", [False, True])
def test_unresolved_result_transport_preserves_candidate_indices_and_reason(conflict):
    # Synthetic site graphs exercise serialization, not a proposed mechanism.
    def site(*ids):
        return PairSite(tuple(AtomRef("m", atom) for atom in ids), 1)

    balance = (PairBalance((site("a"),), (site("b"),)) if conflict else
               PairBalance((site("a", "b"), site("a", "c")),
                           (site("a", "d"), site("a", "e"))))
    result = track_electron_pairs(balance)
    body = serialize_electron_flow(balance, result).model_dump(mode="json")
    assert body["status"] == ("conflict" if conflict else "ambiguous")
    assert body["flows"] == []
    assert body["remaining"]["sources"] == body["sources"]
    assert body["remaining"]["sinks"] == body["sinks"]
    assert body["candidates"] == ([] if conflict else [[0, 0], [0, 1], [1, 0], [1, 1]])
    assert bool(body["reason"]) is conflict
