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
from .chemistry.mapping import find_backbone


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
    """Receive the complete reaction assembled in the frontend."""
    reactants = to_domain_reactants(request.reactants)
    products = to_domain_products(request.products)
    return AtomMappingResponse(
        reactants=request.reactants,
        products=request.products,
        reactant_count=len(reactants.molecules),
        product_count=len(products.molecules),
    )
