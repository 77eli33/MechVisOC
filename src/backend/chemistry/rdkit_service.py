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


def assign_formal_charges(molecule: Molecule) -> Molecule:
    """Return a closed-shell copy of *molecule* with RDKit-valid charges.

    The editor draws every hydrogen explicitly.  Disabling implicit hydrogens
    is therefore essential: otherwise RDKit interprets a drawn O-H fragment
    as water instead of hydroxide.  For each atom we choose the smallest
    formal charge that RDKit accepts without radical electrons.  An octet
    charge breaks ties (notably between carbanions and carbocations).
    """
    rdkit_molecule = to_rdkit_molecule(molecule)
    for atom in rdkit_molecule.GetAtoms():
        atom.SetNoImplicit(True)

    # Reject shell overflow before probing charges so one bad atom cannot make
    # RDKit reject every charge candidate tested for an earlier atom.
    for atom_index, domain_atom in enumerate(molecule.atoms):
        rdkit_atom = rdkit_molecule.GetAtomWithIdx(atom_index)
        bond_order = round(sum(bond.GetBondTypeAsDouble() for bond in rdkit_atom.GetBonds()))
        shell_size = 2 if rdkit_atom.GetAtomicNum() == 1 else 8
        # Period-three and heavier elements can use RDKit-supported expanded
        # valences; only the first two periods have a hard duet/octet ceiling.
        if rdkit_atom.GetAtomicNum() <= 10 and bond_order * 2 > shell_size:
            raise ValueError(
                f"{domain_atom.element} atom {domain_atom.id!r} exceeds its electron shell capacity."
            )

    inferred_atoms: list[Atom] = []
    for atom_index, domain_atom in enumerate(molecule.atoms):
        rdkit_atom = rdkit_molecule.GetAtomWithIdx(atom_index)
        bond_order = round(sum(bond.GetBondTypeAsDouble() for bond in rdkit_atom.GetBonds()))
        shell_size = 2 if rdkit_atom.GetAtomicNum() == 1 else 8
        outer_electrons = _PERIODIC_TABLE.GetNOuterElecs(rdkit_atom.GetAtomicNum())
        octet_charge = outer_electrons + bond_order - shell_size
        candidates: list[int] = []

        with rdBase.BlockLogs():
            for formal_charge in range(-4, 5):
                candidate = Chem.Mol(rdkit_molecule)
                candidate_atom = candidate.GetAtomWithIdx(atom_index)
                candidate_atom.SetFormalCharge(formal_charge)
                candidate_atom.SetNoImplicit(True)
                try:
                    Chem.SanitizeMol(candidate)
                    if candidate_atom.GetNumRadicalElectrons() == 0:
                        candidates.append(formal_charge)
                except (RuntimeError, ValueError):
                    continue

        if not candidates:
            raise ValueError(
                f"{domain_atom.element} atom {domain_atom.id!r} has an invalid electron configuration."
            )

        formal_charge = min(
            candidates,
            key=lambda charge: (abs(charge), charge != octet_charge, abs(charge - octet_charge)),
        )
        rdkit_atom.SetFormalCharge(formal_charge)
        inferred_atoms.append(replace(domain_atom, formal_charge=formal_charge))

    try:
        rdkit_molecule.UpdatePropertyCache(strict=True)
        Chem.SanitizeMol(rdkit_molecule)
    except (RuntimeError, ValueError) as error:
        raise ValueError(f"RDKit rejected the molecule's electron configuration: {error}") from error

    radicals = [atom for atom in rdkit_molecule.GetAtoms() if atom.GetNumRadicalElectrons()]
    if radicals:
        atom = molecule.atoms[radicals[0].GetIdx()]
        raise ValueError(f"{atom.element} atom {atom.id!r} has an unpaired electron.")

    return replace(
        molecule,
        atoms=inferred_atoms,
        charge=sum(atom.formal_charge for atom in inferred_atoms),
    )


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
