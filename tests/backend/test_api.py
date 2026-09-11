from fastapi.testclient import TestClient

from src.backend.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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
        "name": "Br",
        "charge": -1,
        "atoms": [{"id": "br-2", "element": "Br", "x": 0, "y": 0}],
        "bonds": [],
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
        {**product, "atoms": [{**product["atoms"][0], "formal_charge": 0}]}
    ]
    assert body["reactant_count"] == 1
    assert body["product_count"] == 1
    assert body["reactant_buckets"] == [
        {"element_name": "H", "atoms": [{"molecule_id": "reactant-1", "atom_id": "h-1"}]},
        {"element_name": "Br", "atoms": [{"molecule_id": "reactant-1", "atom_id": "br-1"}]},
    ]
    assert body["product_buckets"] == [
        {"element_name": "Br", "atoms": [{"molecule_id": "product-1", "atom_id": "br-2"}]}
    ]
