"""Utilities for deriving atom selections from molecule objects."""


def find_backbone(molecule):
    """Return the selected longest chain in a molecule object."""
    pass


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
