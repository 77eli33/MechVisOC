"""Electron-pair bookkeeping, independent of arrow matching or rendering.

Assumes validated, explicit-H, closed-shell molecules with integer covalent
bond orders. This is formal Lewis bookkeeping, not an orbital/stability test.
All locations are expressed in reactant-side atom references.
"""

from dataclasses import dataclass

from .mapping import get_bond_diffs, map_atoms
from .model import Atom, AtomRef, Products, Reactants

# Main-group valence electrons only; transition-metal electron counting needs
# a different model. No toolkit molecule or implicit hydrogen inference here.
_VALENCE_ELECTRONS = {
    "H": 1, "He": 2,
    "Li": 1, "Be": 2, "B": 3, "C": 4, "N": 5, "O": 6, "F": 7, "Ne": 8,
    "Na": 1, "Mg": 2, "Al": 3, "Si": 4, "P": 5, "S": 6, "Cl": 7, "Ar": 8,
    "K": 1, "Ca": 2, "Ga": 3, "Ge": 4, "As": 5, "Se": 6, "Br": 7, "Kr": 8,
    "Rb": 1, "Sr": 2, "In": 3, "Sn": 4, "Sb": 5, "Te": 6, "I": 7, "Xe": 8,
    "Cs": 1, "Ba": 2, "Tl": 3, "Pb": 4, "Bi": 5, "Po": 6, "At": 7, "Rn": 8,
}


@dataclass(frozen=True)
class PairSite:
    """One atom (free pairs) or two atoms (bond pairs), with pair capacity."""

    atoms: tuple[AtomRef, ...]
    pair_count: int

    def __post_init__(self):
        if len(self.atoms) not in (1, 2) or len(set(self.atoms)) != len(self.atoms):
            raise ValueError("A pair site must identify one atom or two distinct bond endpoints")
        if type(self.pair_count) is not int or self.pair_count <= 0:
            raise ValueError("Pair count must be a positive integer")
        object.__setattr__(self, "atoms", tuple(sorted(
            self.atoms, key=lambda ref: (ref.molecule_id, ref.atom_id)
        )))


@dataclass(frozen=True)
class PairBalance:
    sources: tuple[PairSite, ...]
    sinks: tuple[PairSite, ...]


def count_lone_pairs(atom: Atom, bond_order_sum: int) -> int:
    """Count formal pairs in already validated closed-shell input.

    Even/nonnegative arithmetic alone cannot establish a closed-shell state
    (bare neutral C is a counterexample); this does not replace editor checks.
    """
    if type(bond_order_sum) is not int or bond_order_sum < 0:
        raise ValueError("Bond order sum must be a nonnegative integer")
    if type(atom.formal_charge) is not int:
        raise ValueError("Formal charge must be an integer")
    if atom.element not in _VALENCE_ELECTRONS:
        raise ValueError(f"Unsupported element for electron-pair counting: {atom.element!r}")
    electrons = _VALENCE_ELECTRONS[atom.element] - atom.formal_charge - bond_order_sum
    if electrons < 0 or electrons % 2:
        raise ValueError(
            f"Atom {atom.id!r} has negative or odd nonbonding electron count; "
            "only explicit-H closed-shell states are supported"
        )
    return electrons // 2


def _atom_states(side: Reactants | Products) -> dict[AtomRef, tuple[Atom, int]]:
    """Check bookkeeping prerequisites, without repeating molecule validation."""
    result = {}
    molecule_ids = set()
    for molecule in side.molecules:
        if molecule.molecule_id in molecule_ids:
            raise ValueError("Molecule IDs must be unique on each reaction side")
        molecule_ids.add(molecule.molecule_id)
        atoms = {atom.id: atom for atom in molecule.atoms}
        if len(atoms) != len(molecule.atoms):
            raise ValueError("Atom IDs must be unique within a molecule")
        orders = dict.fromkeys(atoms, 0)
        seen = set()
        for bond in molecule.bonds:
            endpoints = frozenset((bond.atom1_id, bond.atom2_id))
            if len(endpoints) != 2 or not endpoints <= atoms.keys() or endpoints in seen:
                raise ValueError("Invalid or duplicate bond endpoints")
            if type(bond.order) is not int or bond.order not in (1, 2, 3):
                raise ValueError("Only integer bond orders 1, 2, and 3 are supported")
            seen.add(endpoints)
            for atom_id in endpoints:
                orders[atom_id] += bond.order
        for atom in molecule.atoms:
            result[AtomRef(molecule.molecule_id, atom.id)] = (
                atom, count_lone_pairs(atom, orders[atom.id])
            )
    return result


def classify_pair_sources_and_sinks(
    reactants: Reactants,
    products: Products,
    atom_mapping: dict[AtomRef, AtomRef] | None = None,
) -> PairBalance:
    """Qualify changed bond/free pairs, without assigning their destinations.

    Charge changes contribute only through the free-pair difference. Counting
    charge changes separately would count the same electrons twice. Results
    depend on the supplied mapping (or the existing mapper's chosen mapping).
    """
    before, after = _atom_states(reactants), _atom_states(products)
    mapping = atom_mapping if atom_mapping is not None else map_atoms(reactants, products)
    if set(mapping) != set(before) or set(mapping.values()) != set(after) or len(mapping) != len(after):
        raise ValueError("Atom mapping must cover both sides exactly and be one-to-one")
    if any(before[ref][0].element != after[target][0].element for ref, target in mapping.items()):
        raise ValueError("Atom mapping must preserve elements")
    if sum(atom.formal_charge for atom, _ in before.values()) != sum(
        atom.formal_charge for atom, _ in after.values()
    ):
        raise ValueError("Atom formal charges must conserve total charge")

    diff = get_bond_diffs(reactants, products, mapping)
    sources = [PairSite((bond.atom1, bond.atom2), bond.order) for bond in diff.removed_bonds]
    sinks = [PairSite((bond.atom1, bond.atom2), bond.order) for bond in diff.added_bonds]
    for change in diff.order_changed:
        delta = change.new_order - change.old_order
        (sinks if delta > 0 else sources).append(PairSite((change.atom1, change.atom2), abs(delta)))
    for ref in sorted(before, key=lambda item: (item.molecule_id, item.atom_id)):
        delta = after[mapping[ref]][1] - before[ref][1]
        if delta:
            (sinks if delta > 0 else sources).append(PairSite((ref,), abs(delta)))
    if sum(site.pair_count for site in sources) != sum(site.pair_count for site in sinks):
        raise ValueError("Electron-pair sources and sinks do not balance")
    return PairBalance(tuple(sources), tuple(sinks))
