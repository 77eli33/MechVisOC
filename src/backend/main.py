"""FastAPI entrypoint for MechVis."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import (
    AtomMappingRequest,
    AtomMappingResponse,
    BackboneRequest,
    BackboneResponse,
    to_domain_molecule,
    to_domain_products,
    to_domain_reactants,
)
from .chemistry.mapping import find_backbone, map_atoms, sort_atoms_into_buckets


app = FastAPI(title="MechVis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/backbone", response_model=BackboneResponse)
def backbone(request: BackboneRequest) -> BackboneResponse:
    molecule = to_domain_molecule(request.molecule)
    backbone_atoms = find_backbone(molecule)
    return BackboneResponse(
        molecule=request.molecule,
        backbone_atom_ids=[atom.id for atom in backbone_atoms],
    )


@app.post("/api/atom-mapping", response_model=AtomMappingResponse)
def atom_mapping(request: AtomMappingRequest) -> AtomMappingResponse:
    """Receive a reaction and return its element-specific atom buckets."""
    reactants = to_domain_reactants(request.reactants)
    products = to_domain_products(request.products)
    mappings = map_atoms(reactants, products)
    return AtomMappingResponse(
        reactants=request.reactants,
        products=request.products,
        reactant_count=len(reactants.molecules),
        product_count=len(products.molecules),
        reactant_buckets=sort_atoms_into_buckets(reactants),
        product_buckets=sort_atoms_into_buckets(products),
        atom_mappings=[
            {
                "reactant": {"molecule_id": reactant.molecule_id, "atom_id": reactant.atom_id},
                "product": {"molecule_id": product.molecule_id, "atom_id": product.atom_id},
            }
            for reactant, product in mappings.items()
        ],
    )
