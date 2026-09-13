from src.backend.chemistry.mapping import (
    get_bond_diffs,
    map_atoms,
    sort_atoms_into_buckets,
    validate_reaction,
)
from src.backend.chemistry.model import (
    Atom,
    AtomRef,
    Bond,
    BondDiff,
    BondOrderChange,
    MappedBond,
    Molecule,
    Products,
    Reactants,
)


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


def test_validate_reaction_accepts_charge_redistributed_across_molecules() -> None:
    positive = molecule("positive", "N", "H")
    positive.charge = 1
    negative = molecule("negative", "O", "H")
    negative.charge = -1
    combined = molecule("combined", "N", "H", "O", "H")

    assert validate_reaction(Reactants([positive, negative]), Products([combined])) is True


def test_validate_reaction_rejects_different_total_charge() -> None:
    reactant = molecule("reactant", "C", "O")
    product = molecule("product", "C", "O")
    product.charge = -1

    assert validate_reaction(Reactants([reactant]), Products([product])) is False


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


def test_get_bond_diffs_reports_changed_bond_order_once() -> None:
    reactant = Molecule(
        molecule_id="reactant",
        name="carbon monoxide",
        atoms=[Atom("carbon", "C"), Atom("oxygen", "O")],
        bonds=[Bond("carbon", "oxygen", 1)],
    )
    product = Molecule(
        molecule_id="product",
        name="carbon monoxide",
        atoms=[Atom("product-carbon", "C"), Atom("product-oxygen", "O")],
        bonds=[Bond("product-carbon", "product-oxygen", 2)],
    )
    mapping = {
        AtomRef("reactant", "carbon"): AtomRef("product", "product-carbon"),
        AtomRef("reactant", "oxygen"): AtomRef("product", "product-oxygen"),
    }

    diffs = get_bond_diffs(Reactants([reactant]), Products([product]), mapping)

    assert diffs == BondDiff(
        removed_bonds=(),
        added_bonds=(),
        order_changed=(
            BondOrderChange(
                AtomRef("reactant", "carbon"),
                AtomRef("reactant", "oxygen"),
                1,
                2,
            ),
        ),
    )


def test_get_bond_diffs_reports_changed_bond_partners() -> None:
    reactant = Molecule(
        molecule_id="reactant",
        name="before",
        atoms=[Atom("carbon", "C"), Atom("oxygen", "O"), Atom("nitrogen", "N")],
        bonds=[Bond("carbon", "oxygen")],
    )
    product = Molecule(
        molecule_id="product",
        name="after",
        atoms=[Atom("product-carbon", "C"), Atom("product-oxygen", "O"), Atom("product-nitrogen", "N")],
        bonds=[Bond("product-carbon", "product-nitrogen")],
    )
    mapping = {
        AtomRef("reactant", "carbon"): AtomRef("product", "product-carbon"),
        AtomRef("reactant", "oxygen"): AtomRef("product", "product-oxygen"),
        AtomRef("reactant", "nitrogen"): AtomRef("product", "product-nitrogen"),
    }

    diffs = get_bond_diffs(Reactants([reactant]), Products([product]), mapping)

    assert diffs == BondDiff(
        removed_bonds=(
            MappedBond(
                AtomRef("reactant", "carbon"),
                AtomRef("reactant", "oxygen"),
                1,
            ),
        ),
        added_bonds=(
            MappedBond(
                AtomRef("reactant", "carbon"),
                AtomRef("reactant", "nitrogen"),
                1,
            ),
        ),
        order_changed=(),
    )


def test_get_bond_diffs_normalizes_endpoint_order_before_comparison() -> None:
    reactant = Molecule(
        molecule_id="reactant",
        name="before",
        atoms=[Atom("carbon", "C"), Atom("oxygen", "O")],
        bonds=[Bond("carbon", "oxygen", 2)],
    )
    product = Molecule(
        molecule_id="product",
        name="after",
        atoms=[Atom("oxygen-copy", "O"), Atom("carbon-copy", "C")],
        bonds=[Bond("oxygen-copy", "carbon-copy", 2)],
    )

    assert get_bond_diffs(Reactants([reactant]), Products([product])) == BondDiff((), (), ())
