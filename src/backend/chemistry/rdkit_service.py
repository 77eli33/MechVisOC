"""Adapters between the MechVis domain model and RDKit.

RDKit is deliberately kept behind this module. Atom indices in an RDKit
``Mol`` are implementation details and must never be used as atom identities
by the API or the web interface.
"""

from dataclasses import dataclass, replace
from typing import Mapping

from rdkit import Chem
from rdkit import rdBase

from .model import Atom, AtomRef, Bond, Molecule, Products, Reactants


_PERIODIC_TABLE = Chem.GetPeriodicTable()
_ATOM_ID_PROPERTY = "mechvis_atom_id"
_MOLECULE_ID_PROPERTY = "mechvis_molecule_id"
_MOLECULE_NAME_PROPERTY = "mechvis_molecule_name"
_MOLECULE_CHARGE_PROPERTY = "mechvis_molecule_charge"

_BOND_TYPES = {
    1: Chem.BondType.SINGLE,
    2: Chem.BondType.DOUBLE,
    3: Chem.BondType.TRIPLE,
}


@dataclass(frozen=True)
class RDKitReactionSide:
    """An RDKit reaction-side graph and its domain atom identities."""

    molecule: Chem.Mol
    atom_refs: tuple[AtomRef, ...]

    def atom_ref(self, atom_index: int) -> AtomRef:
        return self.atom_refs[atom_index]


def is_valid_element_symbol(symbol: str) -> bool:
    """Return whether *symbol* is an element known to RDKit."""
    try:
        return _PERIODIC_TABLE.GetAtomicNumber(symbol) > 0
    except (RuntimeError, ValueError):
        return False


def to_rdkit_molecule(molecule: Molecule) -> Chem.Mol:
    """Adapt a domain molecule to an RDKit molecule.

    Domain IDs and molecule-level metadata are stored as private RDKit
    properties solely so a later conversion can restore the original model.
    Sanitization is intentionally lenient because editor input can represent
    reaction intermediates whose valence is temporarily incomplete.
    """
    editable = Chem.RWMol()
    atom_indices: dict[str, int] = {}

    for atom in molecule.atoms:
        if atom.id in atom_indices:
            raise ValueError(f"Duplicate atom ID {atom.id!r} in molecule {molecule.molecule_id!r}")
        if not is_valid_element_symbol(atom.element):
            raise ValueError(f"Unknown element symbol {atom.element!r}")

        rdkit_atom = Chem.Atom(atom.element)
        rdkit_atom.SetFormalCharge(atom.formal_charge)
        rdkit_atom.SetProp(_ATOM_ID_PROPERTY, atom.id)
        rdkit_atom.SetProp(_MOLECULE_ID_PROPERTY, molecule.molecule_id)
        atom_indices[atom.id] = editable.AddAtom(rdkit_atom)

    seen_bonds: set[frozenset[str]] = set()
    for bond in molecule.bonds:
        try:
            atom1_index = atom_indices[bond.atom1_id]
            atom2_index = atom_indices[bond.atom2_id]
        except KeyError as error:
            raise ValueError("Every bond endpoint must reference an atom in the molecule") from error
        if atom1_index == atom2_index:
            raise ValueError("A bond cannot connect an atom to itself")
        bond_key = frozenset((bond.atom1_id, bond.atom2_id))
        if bond_key in seen_bonds:
            raise ValueError("A molecule cannot contain duplicate bonds")
        try:
            bond_type = _BOND_TYPES[bond.order]
        except KeyError as error:
            raise ValueError(f"Unsupported bond order {bond.order!r}") from error
        editable.AddBond(atom1_index, atom2_index, bond_type)
        seen_bonds.add(bond_key)

    rdkit_molecule = editable.GetMol()
    rdkit_molecule.SetProp(_MOLECULE_ID_PROPERTY, molecule.molecule_id)
    rdkit_molecule.SetProp(_MOLECULE_NAME_PROPERTY, molecule.name)
    rdkit_molecule.SetIntProp(_MOLECULE_CHARGE_PROPERTY, molecule.charge)
    rdkit_molecule.UpdatePropertyCache(strict=False)
    Chem.GetSymmSSSR(rdkit_molecule)
    return rdkit_molecule


def validate_formal_charges(molecule: Molecule) -> Molecule:
    """Validate explicit-H, closed-shell input without inferring atom charges.

    Incomplete valence must never be repaired by adding charge. Radical
    states require a future explicit model and are currently rejected.
    """
    rdkit_molecule = to_rdkit_molecule(molecule)
    for atom in rdkit_molecule.GetAtoms():
        atom.SetNoImplicit(True)
        bond_order = sum(bond.GetBondTypeAsDouble() for bond in atom.GetBonds())
        shell_size = 2 if atom.GetAtomicNum() == 1 else 8
        if atom.GetAtomicNum() <= 10 and bond_order * 2 > shell_size:
            raise ValueError(
                f"{atom.GetSymbol()} atom {molecule.atoms[atom.GetIdx()].id!r} "
                "exceeds its electron shell capacity."
            )
    try:
        with rdBase.BlockLogs():
            rdkit_molecule.UpdatePropertyCache(strict=True)
            Chem.SanitizeMol(rdkit_molecule)
    except (RuntimeError, ValueError) as error:
        raise ValueError(f"RDKit rejected the molecule's electron configuration: {error}") from error

    for original, checked in zip(molecule.atoms, rdkit_molecule.GetAtoms()):
        if checked.GetFormalCharge() != original.formal_charge:
            raise ValueError("RDKit normalization would change formal charges; enter them explicitly.")
        if checked.GetNumRadicalElectrons():
            raise ValueError(
                f"{original.element} atom {original.id!r} has unpaired electrons. "
                "Draw all hydrogens and set formal charges explicitly. "
                "Radicals are not yet supported; charges were not changed."
            )
    return replace(molecule, atoms=list(molecule.atoms),
                   charge=sum(atom.formal_charge for atom in molecule.atoms))


def from_rdkit_molecule(rdkit_molecule: Chem.Mol) -> Molecule:
    """Convert an adapted RDKit molecule back to the MechVis domain model."""
    molecule_id = _required_property(rdkit_molecule, _MOLECULE_ID_PROPERTY)
    name = (
        rdkit_molecule.GetProp(_MOLECULE_NAME_PROPERTY)
        if rdkit_molecule.HasProp(_MOLECULE_NAME_PROPERTY)
        else molecule_id
    )
    charge = (
        rdkit_molecule.GetIntProp(_MOLECULE_CHARGE_PROPERTY)
        if rdkit_molecule.HasProp(_MOLECULE_CHARGE_PROPERTY)
        else sum(atom.GetFormalCharge() for atom in rdkit_molecule.GetAtoms())
    )

    atoms = [
        Atom(
            id=_required_property(atom, _ATOM_ID_PROPERTY),
            element=atom.GetSymbol(),
            formal_charge=atom.GetFormalCharge(),
        )
        for atom in rdkit_molecule.GetAtoms()
    ]
    atom_ids = [atom.id for atom in atoms]
    bonds = [
        Bond(
            atom1_id=atom_ids[bond.GetBeginAtomIdx()],
            atom2_id=atom_ids[bond.GetEndAtomIdx()],
            order=int(bond.GetBondTypeAsDouble()),
        )
        for bond in rdkit_molecule.GetBonds()
    ]
    return Molecule(molecule_id, name, charge, atoms, bonds)


def to_rdkit_reaction_side(reaction_side: Reactants | Products) -> RDKitReactionSide:
    """Adapt all molecules on one reaction side to one disconnected RDKit graph."""
    combined = Chem.RWMol()
    atom_refs: list[AtomRef] = []

    for molecule in reaction_side.molecules:
        rdkit_molecule = to_rdkit_molecule(molecule)
        offset = combined.GetNumAtoms()
        combined.InsertMol(rdkit_molecule)
        molecule_atom_refs = [
            AtomRef(molecule.molecule_id, _required_property(atom, _ATOM_ID_PROPERTY))
            for atom in rdkit_molecule.GetAtoms()
        ]
        duplicate_refs = set(atom_refs) & set(molecule_atom_refs)
        if duplicate_refs:
            duplicate = min(duplicate_refs, key=lambda ref: (ref.molecule_id, ref.atom_id))
            raise ValueError(
                "Atom references must be unique across a reaction side; "
                f"found {duplicate.molecule_id!r}/{duplicate.atom_id!r} more than once"
            )
        atom_refs.extend(molecule_atom_refs)

        # InsertMol retains atom ordering; assert that assumption at the adapter
        # boundary rather than allowing an unnoticed identity mismatch.
        for local_index, atom_ref in enumerate(molecule_atom_refs):
            inserted_atom = combined.GetAtomWithIdx(offset + local_index)
            if _required_property(inserted_atom, _ATOM_ID_PROPERTY) != atom_ref.atom_id:
                raise RuntimeError("RDKit changed atom ordering while combining molecules")

    rdkit_side = combined.GetMol()
    rdkit_side.UpdatePropertyCache(strict=False)
    Chem.GetSymmSSSR(rdkit_side)
    return RDKitReactionSide(rdkit_side, tuple(atom_refs))


def from_rdkit_atom_mapping(
    reactants: RDKitReactionSide,
    products: RDKitReactionSide,
    mapping: Mapping[int, int],
) -> dict[AtomRef, AtomRef]:
    """Convert an RDKit-index mapping back to stable domain atom references."""
    result: dict[AtomRef, AtomRef] = {}
    used_products: set[AtomRef] = set()
    for reactant_index, product_index in mapping.items():
        reactant_ref = reactants.atom_ref(reactant_index)
        product_ref = products.atom_ref(product_index)
        if reactant_ref in result or product_ref in used_products:
            raise ValueError("RDKit atom mapping must be one-to-one")
        result[reactant_ref] = product_ref
        used_products.add(product_ref)
    return result


def _required_property(item: Chem.Atom | Chem.Mol, property_name: str) -> str:
    if not item.HasProp(property_name):
        raise ValueError(f"RDKit object is missing required adapter property {property_name!r}")
    return item.GetProp(property_name)
