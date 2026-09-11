"""Utilities for deriving atom selections from molecule objects."""

from collections import Counter

from .model import Bucket, BucketAtom, Products, Reactants


def validate_reaction(reactants: Reactants, products: Products) -> bool:
    """Return whether both sides of a reaction contain the same atoms.

    Atom IDs and molecular grouping may change during a reaction, so the
    comparison is made from the total count of each element across all
    molecules on each side. Formal charges and bonds are intentionally not
    considered here.
    """
    reactant_atoms = Counter(
        atom.element
        for molecule in reactants.molecules
        for atom in molecule.atoms
    )
    product_atoms = Counter(
        atom.element
        for molecule in products.molecules
        for atom in molecule.atoms
    )
    return reactant_atoms == product_atoms


def sort_atoms_into_buckets(reaction_side: Reactants | Products) -> list[Bucket]:
    """Group every atom on one reaction side into element-specific buckets.

    Each bucket atom retains both its molecule and atom IDs, since atom IDs
    are only guaranteed to be unique inside an individual molecule.
    """
    buckets: dict[str, Bucket] = {}
    for molecule in reaction_side.molecules:
        for atom in molecule.atoms:
            bucket = buckets.setdefault(atom.element, Bucket(atom.element, []))
            bucket.atoms.append(BucketAtom(molecule.molecule_id, atom.id))
    return list(buckets.values())


def find_backbone(molecule):
    """Return the longest non-H path starting at the first end atom.

    At each intersection, every forward branch is walked recursively.  When
    branches have the same length, the branch encountered last in the
    molecule's bond order is selected.
    """
    ends = find_ends(molecule)
    if not ends:
        return []

    atoms_by_id = {atom.id: atom for atom in molecule.atoms}
    non_h_neighbours = {atom.id: [] for atom in molecule.atoms if atom.is_non_h()}

    for bond in molecule.bonds:
        atom1 = atoms_by_id[bond.atom1_id]
        atom2 = atoms_by_id[bond.atom2_id]

        if atom1.is_non_h() and atom2.is_non_h():
            non_h_neighbours[atom1.id].append(atom2)
            non_h_neighbours[atom2.id].append(atom1)

    def walk(atom, last_atom):
        path = [atom]
        next_atoms = [
            neighbour
            for neighbour in non_h_neighbours[atom.id]
            if last_atom is None or neighbour.id != last_atom.id
        ]

        if len(next_atoms) == 1:
            return path + walk(next_atoms[0], atom)

        if len(next_atoms) > 1:
            longest_branch = []
            for next_atom in next_atoms:
                branch = walk(next_atom, atom)
                if len(branch) >= len(longest_branch):
                    longest_branch = branch
            return path + longest_branch

        return path

    return walk(ends[0], None)


def find_ends(molecule):
    """Return non-H atoms connected to exactly one other heavy atom."""
    atoms_by_id = {atom.id: atom for atom in molecule.atoms}
    non_h_bond_counts = {atom.id: 0 for atom in molecule.atoms if atom.is_non_h()}

    for bond in molecule.bonds:
        atom1 = atoms_by_id[bond.atom1_id]
        atom2 = atoms_by_id[bond.atom2_id]

        if atom1.is_non_h() and atom2.is_non_h():
            non_h_bond_counts[atom1.id] += 1
            non_h_bond_counts[atom2.id] += 1

    return [atom for atom in molecule.atoms if non_h_bond_counts.get(atom.id) == 1]


def find_non_h_atoms(molecule):
    """Return all atoms except hydrogen atoms."""
    return [atom for atom in molecule.atoms if atom.is_non_h()]
