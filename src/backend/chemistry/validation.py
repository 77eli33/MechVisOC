"""Validation rules for molecule-editor input."""

from collections import deque
from typing import Iterable

from .model import Atom, Molecule
from .rdkit_service import is_valid_element_symbol


def validate_atom_names(atoms: Iterable[Atom]) -> list[str]:
    """Validate atom element names using RDKit's periodic table."""
    return [
        f"'{atom.element}' is not a valid element symbol."
        for atom in atoms
        if not is_valid_element_symbol(atom.element)
    ]


def validate_molecule(molecule: Molecule) -> list[str]:
    """Validate rules that must hold before a molecule leaves the editor."""
    errors = validate_atom_names(molecule.atoms)
    if len(molecule.atoms) < 2:
        return errors

    neighbors = {atom.id: set() for atom in molecule.atoms}
    for bond in molecule.bonds:
        neighbors[bond.atom1_id].add(bond.atom2_id)
        neighbors[bond.atom2_id].add(bond.atom1_id)

    visited = {molecule.atoms[0].id}
    queue = deque(visited)
    while queue:
        for neighbor in neighbors[queue.popleft()]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    if len(visited) != len(molecule.atoms):
        errors.append("The molecule contains a hole: every atom must be connected before it can be added.")
    return errors
