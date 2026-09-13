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


def test_incomplete_neutral_carbon_is_not_converted_to_an_anion() -> None:
    from src.backend.chemistry.validation import validate_electron_configuration

    for molecule in [
        Molecule('c', 'C', atoms=[Atom('c', 'C')]),
        Molecule('cc', 'CC', atoms=[Atom('c1', 'C'), Atom('c2', 'C')],
                 bonds=[Bond('c1', 'c2')]),
    ]:
        validated, errors = validate_electron_configuration(molecule)
        assert validated is None
        assert 'unpaired electrons' in errors[0]
        assert all(atom.formal_charge == 0 for atom in molecule.atoms)
        assert molecule.charge == 0


def test_methyl_charge_states_are_preserved_and_radical_is_rejected() -> None:
    from src.backend.chemistry.validation import validate_electron_configuration

    for charge in [-1, 0, 1]:
        molecule = Molecule(
            'methyl', 'CH3', charge=99,
            atoms=[Atom('c', 'C', charge)] + [Atom(f'h{i}', 'H') for i in range(3)],
            bonds=[Bond('c', f'h{i}') for i in range(3)],
        )
        validated, errors = validate_electron_configuration(molecule)
        if charge == 0:
            assert validated is None
            assert 'Radicals are not yet supported' in errors[0]
        else:
            assert errors == []
            assert validated.charge == charge
            assert validated.atoms == molecule.atoms
        assert molecule.charge == 99  # Validation never mutates its input.


def test_neutral_oh_is_not_silently_changed_to_hydroxide() -> None:
    from src.backend.chemistry.validation import validate_electron_configuration

    molecule = Molecule('oh', 'OH', atoms=[Atom('o', 'O'), Atom('h', 'H')],
                        bonds=[Bond('o', 'h')])
    validated, errors = validate_electron_configuration(molecule)
    assert validated is None
    assert 'unpaired electrons' in errors[0]
    assert molecule.atoms[0].formal_charge == 0


def test_explicit_bromide_retains_charge() -> None:
    from src.backend.chemistry.validation import validate_electron_configuration

    validated, errors = validate_electron_configuration(
        Molecule('br', 'Br-', atoms=[Atom('br', 'Br', -1)])
    )
    assert errors == []
    assert validated.charge == -1
    assert validated.atoms[0].formal_charge == -1
