from src.backend.chemistry.mapping import map_atoms, sort_atoms_into_buckets, validate_reaction
from src.backend.chemistry.model import Atom, AtomRef, Bond, Molecule, Products, Reactants


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


def test_map_atoms_maps_repeated_elements_one_to_one() -> None:
    reactants = Reactants([molecule("reactant", "C", "C", "O")])
    products = Products([molecule("product", "C", "O", "C")])

    mappings = map_atoms(reactants, products)

    assert mappings == {
        AtomRef("reactant", "reactant-0"): AtomRef("product", "product-0"),
        AtomRef("reactant", "reactant-1"): AtomRef("product", "product-2"),
        AtomRef("reactant", "reactant-2"): AtomRef("product", "product-1"),
    }


def test_map_atoms_uses_bond_environment_for_reordered_atoms() -> None:
    reactant = Molecule(
        molecule_id="reactant",
        name="ethanol skeleton",
        atoms=[Atom("terminal-c", "C"), Atom("middle-c", "C"), Atom("oxygen", "O")],
        bonds=[
            Bond("terminal-c", "middle-c"),
            Bond("middle-c", "oxygen"),
        ],
    )
    product = Molecule(
        molecule_id="product",
        name="same skeleton, reordered",
        atoms=[Atom("product-o", "O"), Atom("product-middle", "C"), Atom("product-terminal", "C")],
        bonds=[
            Bond("product-o", "product-middle"),
            Bond("product-middle", "product-terminal"),
        ],
    )

    mappings = map_atoms(Reactants([reactant]), Products([product]))

    assert mappings == {
        AtomRef("reactant", "terminal-c"): AtomRef("product", "product-terminal"),
        AtomRef("reactant", "middle-c"): AtomRef("product", "product-middle"),
        AtomRef("reactant", "oxygen"): AtomRef("product", "product-o"),
    }
