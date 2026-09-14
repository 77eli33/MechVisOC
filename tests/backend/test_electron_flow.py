"""Closed-shell bookkeeping and conservative structural tracking."""

import pytest

from src.backend.chemistry.electron_balance import (
    PairBalance, PairSite, classify_pair_sources_and_sinks, count_lone_pairs,
)
from src.backend.chemistry.electron_flow import track_electron_pairs
from src.backend.chemistry.model import Atom, AtomRef, Bond, Molecule, Products, Reactants


def site(*atoms, count=1):
    return PairSite(tuple(AtomRef("m", atom) for atom in atoms), count)


@pytest.mark.parametrize("element,charge,orders,expected", [
    ("Br", 0, 1, 3), ("Br", -1, 0, 4), ("C", 1, 3, 0),
    ("C", -1, 3, 1), ("O", 0, 2, 2), ("O", -1, 1, 3), ("H", 1, 0, 0),
])
def test_lone_pairs(element, charge, orders, expected):
    assert count_lone_pairs(Atom("a", element, charge), orders) == expected


def test_implicit_carbon_hydrogens_contribute_bonding_electrons():
    assert count_lone_pairs(Atom("c", "C", implicit_hydrogens=4), 0) == 0


@pytest.mark.parametrize("atom,orders", [
    (Atom("a", "C"), 3), (Atom("a", "C", 2), 3),
    (Atom("a", "Fe"), 0), (Atom("a", "O"), 1.5),
    (Atom("a", "O", 0.5), 1), (Atom("a", "C"), -1),
])
def test_unsupported_electron_states(atom, orders):
    with pytest.raises(ValueError):
        count_lone_pairs(atom, orders)


def protonation():
    ethene = Molecule("ethene", "ethene", atoms=[Atom("c1", "C"), Atom("c2", "C")]
                     + [Atom(f"h{i}", "H") for i in range(4)],
                     bonds=[Bond("c1", "c2", 2), Bond("c1", "h0"), Bond("c1", "h1"),
                            Bond("c2", "h2"), Bond("c2", "h3")])
    acid = Molecule("acid", "HBr", atoms=[Atom("h", "H"), Atom("br", "Br")], bonds=[Bond("h", "br")])
    product = Molecule("cation", "cation", 1,
                       [Atom("c1", "C"), Atom("c2", "C", 1)] + ethene.atoms[2:] + [Atom("h", "H")],
                       [Bond("c1", "c2"), *ethene.bonds[1:], Bond("c1", "h")])
    bromide = Molecule("bromide", "bromide", -1, [Atom("br", "Br", -1)])
    return Reactants([ethene, acid]), Products([product, bromide])


def test_protonation_with_existing_automatic_mapping():
    before, after = protonation()
    balance = classify_pair_sources_and_sinks(before, after)
    assert len(balance.sources) == len(balance.sinks) == 2
    result = track_electron_pairs(balance)
    assert result.status == "complete"
    assert not result.remaining.sources and not result.remaining.sinks
    actual = {(frozenset(a.atom_id for a in flow.source.atoms),
               frozenset(a.atom_id for a in flow.sink.atoms), flow.pair_count) for flow in result.flows}
    assert actual == {(frozenset(("c1", "c2")), frozenset(("c1", "h")), 1),
                      (frozenset(("h", "br")), frozenset(("br",)), 1)}


def test_hydroxide_substitution_uses_free_pair_source():
    methyl_atoms = [Atom("c", "C"), Atom("br", "Br")] + [Atom(f"h{i}", "H") for i in range(3)]
    methyl_bonds = [Bond("c", "br"), *[Bond("c", f"h{i}") for i in range(3)]]
    before = Reactants([
        Molecule("m", "bromomethane", atoms=methyl_atoms, bonds=methyl_bonds),
        Molecule("oh", "hydroxide", -1, [Atom("o", "O", -1), Atom("h", "H")], [Bond("o", "h")]),
    ])
    after = Products([
        Molecule("p", "methanol", atoms=[a for a in methyl_atoms if a.id != "br"] + [Atom("o", "O"), Atom("h", "H")],
                 bonds=methyl_bonds[1:] + [Bond("c", "o"), Bond("o", "h")]),
        Molecule("br", "bromide", -1, [Atom("br", "Br", -1)]),
    ])
    mapping = {AtomRef("m", a.id): AtomRef("br" if a.id == "br" else "p", a.id) for a in methyl_atoms}
    mapping.update({AtomRef("oh", a): AtomRef("p", a) for a in ("o", "h")})
    balance = classify_pair_sources_and_sinks(before, after, mapping)
    oxygen = PairSite((AtomRef("oh", "o"),), 1)
    new_bond = PairSite((AtomRef("m", "c"), AtomRef("oh", "o")), 1)
    assert balance == PairBalance((site("br", "c"), oxygen), (new_bond, site("br")))
    result = track_electron_pairs(balance)
    assert result.status == "complete"
    assert {(flow.source, flow.sink) for flow in result.flows} == {
        (oxygen, new_bond), (site("br", "c"), site("br")),
    }


def test_capacity_splits_multiple_pairs():
    result = track_electron_pairs(PairBalance((site("a", "b", count=3),),
                                             (site("a", count=2), site("b"))))
    assert result.status == "complete"
    assert sorted(flow.pair_count for flow in result.flows) == [1, 2]


def test_ambiguity_is_preserved():
    result = track_electron_pairs(PairBalance((site("a", "b"), site("a", "c")),
                                             (site("a", "d"), site("a", "e"))))
    assert result.status == "ambiguous"
    assert not result.flows
    assert len(result.candidates) == 4


@pytest.mark.parametrize("balance", [
    PairBalance((site("a", count=2),), (site("a", "b"),)),
    PairBalance((site("a"), site("b")), (site("a", "c"), site("d"))),
    PairBalance((site("a"), site("a", "b")), (site("a", "c"), site("d"))),
])
def test_conflicting_or_unbalanced_capacities(balance):
    result = track_electron_pairs(balance)
    assert result.status == "conflict"
    assert not result.flows


def test_empty_balance_is_complete():
    assert track_electron_pairs(PairBalance((), ())).status == "complete"


def test_incomplete_mapping_rejected():
    before, after = protonation()
    with pytest.raises(ValueError, match="cover both sides"):
        classify_pair_sources_and_sinks(before, after, {})


def test_duplicate_locations_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        track_electron_pairs(PairBalance((site("a"), site("a")), (site("a", count=2),)))


def test_reverse_protonation_negative_charge_delta_is_not_a_free_pair_sink():
    before, after = protonation()
    balance = classify_pair_sources_and_sinks(Reactants(after.molecules), Products(before.molecules))
    assert sum(len(site.atoms) == 1 for site in balance.sources) == 1
    assert all(len(site.atoms) == 2 for site in balance.sinks)
    assert track_electron_pairs(balance).status == "complete"


def test_partial_forced_component_keeps_other_component_ambiguous():
    result = track_electron_pairs(PairBalance(
        (site("x"), site("a", "b"), site("a", "c")),
        (site("x", "y"), site("a", "d"), site("a", "e")),
    ))
    assert result.status == "ambiguous"
    assert len(result.flows) == 1
    assert result.candidates == ((0, 0), (0, 1), (1, 0), (1, 1))


def test_multi_order_change_preserves_pair_count():
    # Acetylene + two H2 -> ethane is bookkeeping only, not a claim that this
    # net hydrogenation is an elementary mechanism supported by our tracker.
    carbons = [Atom("a", "C"), Atom("b", "C")]
    hydrogens = [Atom(f"h{i}", "H") for i in range(6)]
    atoms = carbons + hydrogens
    before_bonds = [Bond("a", "b", 3), Bond("a", "h0"), Bond("b", "h1"),
                    Bond("h2", "h3"), Bond("h4", "h5")]
    after_bonds = [Bond("a", "b"), Bond("a", "h0"), Bond("b", "h1"),
                   Bond("a", "h2"), Bond("a", "h4"), Bond("b", "h3"), Bond("b", "h5")]
    before = Reactants([Molecule("m", "acetylene", atoms=atoms[:4], bonds=before_bonds[:3]),
                       Molecule("h2a", "hydrogen", atoms=atoms[4:6], bonds=[before_bonds[3]]),
                       Molecule("h2b", "hydrogen", atoms=atoms[6:], bonds=[before_bonds[4]])])
    after = Products([Molecule("p", "side", atoms=atoms, bonds=after_bonds)])
    balance = classify_pair_sources_and_sinks(before, after,
        {AtomRef(m.molecule_id, a.id): AtomRef("p", a.id) for m in before.molecules for a in m.atoms})
    assert site("a", "b", count=2) in balance.sources
    assert sum(s.pair_count for s in balance.sources) == 4
    assert sum(s.pair_count for s in balance.sinks) == 4


@pytest.mark.parametrize("mutation", ["duplicate", "endpoint", "order", "charge", "element"])
def test_bad_graph_mapping_or_charge_rejected(mutation):
    before, after = protonation()
    mapping = {AtomRef("ethene", a.id): AtomRef("cation", a.id) for a in before.molecules[0].atoms}
    mapping.update({AtomRef("acid", "h"): AtomRef("cation", "h"),
                    AtomRef("acid", "br"): AtomRef("bromide", "br")})
    if mutation == "duplicate":
        before.molecules[0].bonds.append(before.molecules[0].bonds[0])
    elif mutation == "endpoint":
        before.molecules[0].bonds.append(Bond("missing", "c1"))
    elif mutation == "order":
        before.molecules[0].bonds[0] = Bond("c1", "c2", 1.5)
    elif mutation == "charge":
        after.molecules[1].atoms[0] = Atom("br", "Br", 1)
    else:
        mapping[AtomRef("ethene", "c1")], mapping[AtomRef("acid", "br")] = (
            mapping[AtomRef("acid", "br")], mapping[AtomRef("ethene", "c1")])
    with pytest.raises(ValueError):
        classify_pair_sources_and_sinks(before, after, mapping)


def test_capacity_conflict_even_when_every_site_has_candidates():
    balance = PairBalance((site("a", count=2), site("b", count=2)),
                          (site("a", "c", count=3), site("b", "d")))
    result = track_electron_pairs(balance)
    assert result.status == "conflict"
    assert len(result.candidates) == 2


def test_removed_and_added_double_bonds_carry_two_pairs():
    # Exchanging two mapped oxygens is a structural fixture, not a proposed
    # elementary mechanism. Both sides contain two complete formaldehydes.
    def molecule(name, oxygen):
        return Molecule(name, "formaldehyde", atoms=[Atom("c", "C"), Atom(oxygen, "O"), Atom("h1", "H"), Atom("h2", "H")],
                        bonds=[Bond("c", oxygen, 2), Bond("c", "h1"), Bond("c", "h2")])
    before = Reactants([molecule("a", "o1"), molecule("b", "o2")])
    after = Products([molecule("a", "o2"), molecule("b", "o1")])
    mapping = {AtomRef(m.molecule_id, atom.id): AtomRef(
        ("b" if m.molecule_id == "a" else "a") if atom.element == "O" else m.molecule_id, atom.id)
        for m in before.molecules for atom in m.atoms}
    balance = classify_pair_sources_and_sinks(before, after, mapping)
    assert len(balance.sources) == len(balance.sinks) == 2
    assert all(site.pair_count == 2 and len(site.atoms) == 2 for site in balance.sources + balance.sinks)
