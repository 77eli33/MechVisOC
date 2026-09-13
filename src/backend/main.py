"""FastAPI entrypoint for MechVis."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .api import (
    AtomValidationRequest,
    AtomMappingRequest,
    AtomMappingResponse,
    BackboneRequest,
    BackboneResponse,
    MoleculeValidationRequest,
    MoleculeValidationResponse,
    ValidationResponse,
    to_domain_molecule,
    to_domain_products,
    to_domain_reactants,
)
from .chemistry.mapping import (
    find_backbone,
    get_bond_diffs,
    map_atoms,
    sort_atoms_into_buckets,
    validate_reaction,
)
from .electron_flow_api import ElectronFlowResponse, serialize_electron_flow
from .chemistry.electron_balance import classify_pair_sources_and_sinks
from .chemistry.electron_flow import track_electron_pairs
from .chemistry.model import Atom
from .chemistry.validation import validate_atom_names, validate_electron_configuration


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


@app.post("/api/validate-atoms", response_model=ValidationResponse)
def validate_atoms(request: AtomValidationRequest) -> ValidationResponse:
    """Validate editor atoms without requiring a completed molecule."""
    errors = validate_atom_names(Atom(atom.id, atom.element) for atom in request.atoms)
    return ValidationResponse(valid=not errors, errors=errors)


@app.post("/api/validate-molecule", response_model=MoleculeValidationResponse)
def validate_completed_molecule(request: MoleculeValidationRequest) -> MoleculeValidationResponse:
    """Validate a molecule before it is added to a reaction side."""
    molecule, errors = validate_electron_configuration(to_domain_molecule(request.molecule))
    if molecule is None:
        return MoleculeValidationResponse(valid=False, errors=errors)

    atoms_by_id = {atom.id: atom for atom in molecule.atoms}
    normalized_payload = request.molecule.model_copy(
        update={
            "charge": molecule.charge,
            "atoms": [
                atom.model_copy(update={"formal_charge": atoms_by_id[atom.id].formal_charge})
                for atom in request.molecule.atoms
            ],
        }
    )
    return MoleculeValidationResponse(valid=True, errors=[], molecule=normalized_payload)


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
    return _mapped_reaction(request)[0]


def _mapped_reaction(request: AtomMappingRequest):
    """Use one chosen mapping for all downstream reaction information."""
    reactants = to_domain_reactants(request.reactants)
    products = to_domain_products(request.products)
    if not validate_reaction(reactants, products):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid Reaction: reactants and products must contain exactly "
                "the same atoms and total charge."
            ),
        )
    try:
        mappings = map_atoms(reactants, products)
        bond_diffs = get_bond_diffs(reactants, products, mappings)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    response = AtomMappingResponse(
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
        bond_diffs=bond_diffs,
    )
    return response, reactants, products, mappings


@app.post("/api/electron-flow", response_model=ElectronFlowResponse)
def electron_flow(request: AtomMappingRequest) -> ElectronFlowResponse:
    """Analyze already editor-validated, explicit-H closed-shell molecules."""
    response, reactants, products, mappings = _mapped_reaction(request)
    try:
        balance = classify_pair_sources_and_sinks(reactants, products, mappings)
        result = track_electron_pairs(balance)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return ElectronFlowResponse(
        **response.model_dump(), electron_flow=serialize_electron_flow(balance, result)
    )
