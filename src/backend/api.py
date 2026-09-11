"""HTTP schemas and conversion helpers for the MechVis API."""

from typing import List

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .chemistry.model import Atom, Bond, Molecule, Products, Reactants


class AtomPayload(BaseModel):
    id: str
    element: str = Field(min_length=1, max_length=2)
    x: int
    y: int
    formal_charge: int = 0

    @field_validator("element")
    @classmethod
    def normalize_element(cls, value: str) -> str:
        if not value.isalpha():
            raise ValueError("Element shorthand must contain letters only")
        return value[0].upper() + value[1:].lower()


class BondPayload(BaseModel):
    atom1_id: str
    atom2_id: str
    order: int = Field(default=1, ge=1, le=3)


class MoleculePayload(BaseModel):
    id: str
    name: str = "Untitled molecule"
    charge: int = 0
    atoms: List[AtomPayload] = Field(min_length=1)
    bonds: List[BondPayload] = Field(default_factory=list)


class BackboneRequest(BaseModel):
    molecule: MoleculePayload


class BackboneResponse(BaseModel):
    molecule: MoleculePayload
    backbone_atom_ids: List[str]


class ReactantsPayload(BaseModel):
    molecules: List[MoleculePayload] = Field(default_factory=list)


class ProductsPayload(BaseModel):
    molecules: List[MoleculePayload] = Field(default_factory=list)


class AtomMappingRequest(BaseModel):
    reactants: ReactantsPayload
    products: ProductsPayload


class BucketAtomPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    molecule_id: str
    atom_id: str


class BucketPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    element_name: str
    atoms: List[BucketAtomPayload]


class AtomMappingResponse(BaseModel):
    reactants: ReactantsPayload
    products: ProductsPayload
    reactant_count: int
    product_count: int
    reactant_buckets: List[BucketPayload]
    product_buckets: List[BucketPayload]


def to_domain_molecule(payload: MoleculePayload) -> Molecule:
    """Convert an API molecule into the chemistry domain model."""
    atom_ids = [atom.id for atom in payload.atoms]
    if len(atom_ids) != len(set(atom_ids)):
        raise HTTPException(status_code=422, detail="Atom IDs must be unique")

    known_atoms = set(atom_ids)
    for bond in payload.bonds:
        if bond.atom1_id not in known_atoms or bond.atom2_id not in known_atoms:
            raise HTTPException(
                status_code=422,
                detail="Every bond endpoint must reference an atom in the molecule",
            )
        if bond.atom1_id == bond.atom2_id:
            raise HTTPException(status_code=422, detail="A bond cannot connect an atom to itself")

    molecule = Molecule(payload.id, payload.name, payload.charge)
    for atom in payload.atoms:
        molecule.add_atom(Atom(atom.id, atom.element, atom.formal_charge))
    for bond in payload.bonds:
        molecule.add_bond(Bond(bond.atom1_id, bond.atom2_id, bond.order))
    return molecule


def to_domain_reactants(payload: ReactantsPayload) -> Reactants:
    """Convert all reactant payloads into the chemistry domain model."""
    return Reactants(molecules=[to_domain_molecule(molecule) for molecule in payload.molecules])


def to_domain_products(payload: ProductsPayload) -> Products:
    """Convert all product payloads into the chemistry domain model."""
    return Products(molecules=[to_domain_molecule(molecule) for molecule in payload.molecules])
