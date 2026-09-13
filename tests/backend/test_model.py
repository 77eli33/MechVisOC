from src.backend.chemistry.model import Atom


def test_atom_exposes_editor_model_fields() -> None:
    atom = Atom(
        id="chloride",
        element="Cl",
        formal_charge=-1,
        electron_count=18,
        proton_count=17,
    )

    assert atom.name == "Cl"
    assert atom.charge == -1
    assert atom.electron_count == 18
    assert atom.proton_count == 17
