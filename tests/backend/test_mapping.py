from src.backend.chemistry.mapping import sort_atoms_into_buckets, validate_reaction
from src.backend.chemistry.model import Atom, Molecule, Products, Reactants


def molecule(molecule_id: str, *elements: str) -> Molecule:
    return Molecule(
        molecule_id=molecule_id,
        name=molecule_id,
        atoms=[Atom(f"{molecule_id}-{index}", element) for index, element in enumerate(elements)],
    )


def test_validate_reaction_accepts_atom_conservation_across_molecules() -> None:
    reactants = Reactants([molecule("reactant-1", "C", "H", "H"), molecule("reactant-2", "O")])
    products = Products([molecule("product-1", "H", "C", "O", "H")])

    assert validate_reaction(reactants, products) is True


def test_validate_reaction_rejects_different_atom_totals() -> None:
    reactants = Reactants([molecule("reactant-1", "C", "H", "H")])
    products = Products([molecule("product-1", "C", "H")])

    assert validate_reaction(reactants, products) is False


def test_sort_atoms_into_buckets_keeps_molecule_and_atom_ids() -> None:
    reactants = Reactants([
        molecule("reactant-1", "C", "H"),
        molecule("reactant-2", "C", "O"),
    ])

    buckets = sort_atoms_into_buckets(reactants)

    assert [(bucket.element_name, [(atom.molecule_id, atom.atom_id) for atom in bucket.atoms]) for bucket in buckets] == [
        ("C", [("reactant-1", "reactant-1-0"), ("reactant-2", "reactant-2-0")]),
        ("H", [("reactant-1", "reactant-1-1")]),
        ("O", [("reactant-2", "reactant-2-1")]),
    ]
