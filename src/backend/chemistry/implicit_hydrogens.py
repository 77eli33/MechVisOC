"""Inference of carbon-bound hydrogens for editor molecule skeletons."""

from dataclasses import replace

from .model import Atom, Molecule


def infer_carbon_hydrogens(molecule: Molecule) -> Molecule:
    """Return a copy with each carbon's implicit hydrogen count normalized.

    The editor models the common closed-shell Lewis state for carbon: neutral
    carbon has valence four, while each magnitude of formal charge lowers that
    target by one.  Negative charge is therefore represented as an additional
    lone pair, while positive charge represents an electron-deficient carbon.
    Explicit bonds, including deliberately drawn C-H bonds at reaction sites,
    occupy the target valence before implicit hydrogens are added.
    """
    bond_orders = dict.fromkeys((atom.id for atom in molecule.atoms), 0)
    for bond in molecule.bonds:
        if bond.atom1_id not in bond_orders or bond.atom2_id not in bond_orders:
            raise ValueError("Every bond endpoint must reference an atom in the molecule")
        if type(bond.order) is not int or bond.order not in (1, 2, 3):
            raise ValueError("Only integer bond orders 1, 2, and 3 are supported")
        bond_orders[bond.atom1_id] += bond.order
        bond_orders[bond.atom2_id] += bond.order

    normalized_atoms: list[Atom] = []
    for atom in molecule.atoms:
        implicit_hydrogens = 0
        if atom.element == "C":
            target_valence = 4 - abs(atom.formal_charge)
            if target_valence < 0:
                raise ValueError(
                    f"C atom {atom.id!r} has a formal charge outside the supported implicit-H range."
                )
            implicit_hydrogens = target_valence - bond_orders[atom.id]
            if implicit_hydrogens < 0:
                raise ValueError(
                    f"C atom {atom.id!r} exceeds valence {target_valence} "
                    f"for formal charge {atom.formal_charge:+d}."
                )
        normalized_atoms.append(replace(atom, implicit_hydrogens=implicit_hydrogens))

    return replace(molecule, atoms=normalized_atoms)
