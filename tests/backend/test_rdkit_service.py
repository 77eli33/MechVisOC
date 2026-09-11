from src.backend.chemistry.model import Atom, AtomRef, Bond, Molecule, Products, Reactants
from src.backend.chemistry.rdkit_service import (
    from_rdkit_atom_mapping,
    from_rdkit_molecule,
    to_rdkit_molecule,
    to_rdkit_reaction_side,
)


def test_rdkit_molecule_adapter_round_trips_domain_data() -> None:
    molecule = Molecule(
        molecule_id="ion-1",
        name="carbon monoxide",
        charge=-1,
        atoms=[Atom("carbon", "C", -1), Atom("oxygen", "O")],
        bonds=[Bond("carbon", "oxygen", 2)],
    )

    restored = from_rdkit_molecule(to_rdkit_molecule(molecule))

    assert restored == molecule


def test_rdkit_mapping_adapter_restores_stable_atom_references() -> None:
    reactants = to_rdkit_reaction_side(
        Reactants(
            [
                Molecule("first", "C", atoms=[Atom("atom", "C")]),
                Molecule("second", "O", atoms=[Atom("atom", "O")]),
            ]
        )
    )
    products = to_rdkit_reaction_side(
        Products(
            [
                Molecule("product", "CO", atoms=[Atom("oxygen", "O"), Atom("carbon", "C")]),
            ]
        )
    )

    mapping = from_rdkit_atom_mapping(reactants, products, {0: 1, 1: 0})

    assert mapping == {
        AtomRef("first", "atom"): AtomRef("product", "carbon"),
        AtomRef("second", "atom"): AtomRef("product", "oxygen"),
    }
