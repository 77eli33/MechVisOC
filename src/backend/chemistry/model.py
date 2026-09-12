"""Core molecule data structures used by the chemistry algorithms."""

from dataclasses import dataclass, field
from typing import List


@dataclass(frozen=True)
class Atom:
    id: str
    element: str
    formal_charge: int = 0
    electron_count: int | None = None
    proton_count: int | None = None

    @property
    def name(self) -> str:
        """The atom name used by the editor model (its element symbol)."""
        return self.element

    @property
    def charge(self) -> int:
        """Expose formal charge using the editor model's shorter field name."""
        return self.formal_charge

    def is_non_h(self) -> bool:
        if not self.element:
            raise ValueError("Atom has no element")
        return self.element != "H"


@dataclass(frozen=True)
class Bond:
    atom1_id: str
    atom2_id: str
    order: int = 1


@dataclass
class Molecule:
    molecule_id: str
    name: str
    charge: int = 0
    atoms: List[Atom] = field(default_factory=list)
    bonds: List[Bond] = field(default_factory=list)

    def add_atom(self, atom: Atom) -> None:
        self.atoms.append(atom)

    def add_bond(self, bond: Bond) -> None:
        self.bonds.append(bond)


@dataclass
class Reactants:
    """Molecules on the left-hand side of a reaction."""

    molecules: List[Molecule] = field(default_factory=list)


@dataclass
class Products:
    """Molecules on the right-hand side of a reaction."""

    molecules: List[Molecule] = field(default_factory=list)


@dataclass
class Bucket:
    element_name: str
    atoms: list["BucketAtom"]


@dataclass(frozen=True)
class BucketAtom:
    """An atom reference that remains unique across all reaction molecules."""

    molecule_id: str
    atom_id: str


@dataclass(frozen=True)
class AtomRef:
    molecule_id: str
    atom_id: str


@dataclass(frozen=True)
class MappedBond:
    """A canonical bond whose endpoints use reactant-side atom references."""

    atom1: AtomRef
    atom2: AtomRef
    order: int


@dataclass(frozen=True)
class BondDiff:
    """Reaction-level bond removals and additions."""

    removed_bonds: tuple[MappedBond, ...]
    added_bonds: tuple[MappedBond, ...]
