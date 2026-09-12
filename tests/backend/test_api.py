from fastapi.testclient import TestClient

from src.backend.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_validate_atoms_uses_rdkit_element_names() -> None:
    response = client.post(
        "/api/validate-atoms",
        json={"atoms": [{"id": "c-1", "element": "c"}, {"id": "bad-1", "element": "Xx"}]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "errors": ["'Xx' is not a valid element symbol."],
    }


def test_validate_molecule_rejects_disconnected_atoms() -> None:
    response = client.post(
        "/api/validate-molecule",
        json={
            "molecule": {
                "id": "molecule-with-hole",
                "atoms": [
                    {"id": "c-1", "element": "C", "x": -1, "y": 0},
                    {"id": "c-2", "element": "C", "x": 1, "y": 0},
                ],
                "bonds": [],
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert "hole" in response.json()["errors"][0]


def test_validate_molecule_accepts_connected_atoms() -> None:
    response = client.post(
        "/api/validate-molecule",
        json={
            "molecule": {
                "id": "connected-molecule",
                "atoms": [
                    {"id": "h-1", "element": "H", "x": -1, "y": 0},
                    {"id": "o-1", "element": "O", "x": 0, "y": 0},
                    {"id": "h-2", "element": "H", "x": 1, "y": 0},
                ],
                "bonds": [
                    {"atom1_id": "h-1", "atom2_id": "o-1"},
                    {"atom1_id": "o-1", "atom2_id": "h-2"},
                ],
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["errors"] == []
    assert body["molecule"]["charge"] == 0


def test_validate_molecule_infers_and_returns_hydroxide_charge() -> None:
    response = client.post(
        "/api/validate-molecule",
        json={
            "molecule": {
                "id": "hydroxide",
                "atoms": [
                    {"id": "o-1", "element": "O", "x": 0, "y": 0},
                    {"id": "h-1", "element": "H", "x": 1, "y": 0},
                ],
                "bonds": [{"atom1_id": "o-1", "atom2_id": "h-1"}],
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["molecule"]["charge"] == -1
    assert [atom["formal_charge"] for atom in body["molecule"]["atoms"]] == [-1, 0]


def test_validate_molecule_rejects_an_over_bonded_hydrogen() -> None:
    response = client.post(
        "/api/validate-molecule",
        json={
            "molecule": {
                "id": "invalid-hydrogen",
                "atoms": [
                    {"id": "o-1", "element": "O", "x": -1, "y": 0},
                    {"id": "h-1", "element": "H", "x": 0, "y": 0},
                    {"id": "o-2", "element": "O", "x": 1, "y": 0},
                ],
                "bonds": [
                    {"atom1_id": "o-1", "atom2_id": "h-1"},
                    {"atom1_id": "h-1", "atom2_id": "o-2"},
                ],
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert "electron shell capacity" in response.json()["errors"][0]


def test_backbone_returns_heavy_atom_path_and_original_geometry() -> None:
    payload = {
        "molecule": {
            "id": "molecule-1",
            "name": "demo",
            "charge": 0,
            "atoms": [
                {"id": "c-1", "element": "C", "x": -1, "y": 0},
                {"id": "c-2", "element": "C", "x": 0, "y": 0},
                {"id": "br-1", "element": "Br", "x": 1, "y": 0},
                {"id": "h-1", "element": "H", "x": 0, "y": 1},
            ],
            "bonds": [
                {"atom1_id": "c-1", "atom2_id": "c-2", "order": 1},
                {"atom1_id": "c-2", "atom2_id": "br-1", "order": 1},
                {"atom1_id": "c-2", "atom2_id": "h-1", "order": 1},
            ],
        }
    }

    response = client.post("/api/backbone", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["backbone_atom_ids"] == ["c-1", "c-2", "br-1"]
    assert body["molecule"]["id"] == payload["molecule"]["id"]
    assert [(atom["id"], atom["x"], atom["y"]) for atom in body["molecule"]["atoms"]] == [
        ("c-1", -1, 0),
        ("c-2", 0, 0),
        ("br-1", 1, 0),
        ("h-1", 0, 1),
    ]


def test_backbone_rejects_unknown_bond_endpoint() -> None:
    payload = {
        "molecule": {
            "id": "molecule-1",
            "atoms": [{"id": "c-1", "element": "C", "x": 0, "y": 0}],
            "bonds": [{"atom1_id": "c-1", "atom2_id": "missing", "order": 1}],
        }
    }

    response = client.post("/api/backbone", json=payload)

    assert response.status_code == 422
    assert "bond endpoint" in response.json()["detail"]


def test_atom_mapping_receives_all_reactant_and_product_molecules() -> None:
    reactant = {
        "id": "reactant-1",
        "name": "HBr",
        "charge": 0,
        "atoms": [
            {"id": "h-1", "element": "H", "x": 0, "y": 0},
            {"id": "br-1", "element": "Br", "x": 1, "y": 0},
        ],
        "bonds": [{"atom1_id": "h-1", "atom2_id": "br-1", "order": 1}],
    }
    product = {
        "id": "product-1",
        "name": "HBr",
        "charge": -1,
        "atoms": [
            {"id": "br-2", "element": "Br", "x": 0, "y": 0},
            {"id": "h-2", "element": "H", "x": 1, "y": 0},
        ],
        "bonds": [{"atom1_id": "br-2", "atom2_id": "h-2", "order": 1}],
    }
    payload = {
        "reactants": {"molecules": [reactant]},
        "products": {"molecules": [product]},
    }

    response = client.post("/api/atom-mapping", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["reactants"]["molecules"] == [
        {
            **reactant,
            "atoms": [
                {**reactant["atoms"][0], "formal_charge": 0},
                {**reactant["atoms"][1], "formal_charge": 0},
            ],
        }
    ]
    assert body["products"]["molecules"] == [
        {
            **product,
            "atoms": [
                {**product["atoms"][0], "formal_charge": 0},
                {**product["atoms"][1], "formal_charge": 0},
            ],
        }
    ]
    assert body["reactant_count"] == 1
    assert body["product_count"] == 1
    assert body["reactant_buckets"] == [
        {"element_name": "H", "atoms": [{"molecule_id": "reactant-1", "atom_id": "h-1"}]},
        {"element_name": "Br", "atoms": [{"molecule_id": "reactant-1", "atom_id": "br-1"}]},
    ]
    assert body["product_buckets"] == [
        {"element_name": "Br", "atoms": [{"molecule_id": "product-1", "atom_id": "br-2"}]},
        {"element_name": "H", "atoms": [{"molecule_id": "product-1", "atom_id": "h-2"}]},
    ]
    assert body["atom_mappings"] == [
        {
            "reactant": {"molecule_id": "reactant-1", "atom_id": "h-1"},
            "product": {"molecule_id": "product-1", "atom_id": "h-2"},
        },
        {
            "reactant": {"molecule_id": "reactant-1", "atom_id": "br-1"},
            "product": {"molecule_id": "product-1", "atom_id": "br-2"},
        }
    ]


def test_atom_mapping_rejects_reaction_with_different_atoms() -> None:
    payload = {
        "reactants": {
            "molecules": [{
                "id": "reactant-1",
                "atoms": [{"id": "c-1", "element": "C", "x": 0, "y": 0}],
            }]
        },
        "products": {
            "molecules": [{
                "id": "product-1",
                "atoms": [{"id": "o-1", "element": "O", "x": 0, "y": 0}],
            }]
        },
    }

    response = client.post("/api/atom-mapping", json=payload)

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Invalid Reaction: reactants and products must contain exactly the same atoms."
    }


def test_atom_mapping_reports_invalid_rdkit_input_as_validation_error() -> None:
    molecule = {
        "id": "invalid-molecule",
        "atoms": [{"id": "unknown", "element": "Xx", "x": 0, "y": 0}],
    }

    response = client.post(
        "/api/atom-mapping",
        json={
            "reactants": {"molecules": [molecule]},
            "products": {"molecules": [molecule]},
        },
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Unknown element symbol 'Xx'"}
