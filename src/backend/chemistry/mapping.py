"""Reaction atom mapping and molecule-graph utilities."""

from collections import Counter

from rdkit import Chem
from rdkit.Chem import rdFMCS

from .model import AtomRef, Bucket, BucketAtom, Products, Reactants
from .rdkit_service import (
    RDKitReactionSide,
    from_rdkit_atom_mapping,
    to_rdkit_reaction_side,
)


def validate_reaction(reactants: Reactants, products: Products) -> bool:
    """Return whether both sides of a reaction contain the same atoms.

    Atom IDs and molecular grouping may change during a reaction, so the
    comparison is made from the total count of each element across all
    molecules on each side. Formal charges and bonds are intentionally not
    considered here.
    """
    reactant_atoms = Counter(
        atom.element
        for molecule in reactants.molecules
        for atom in molecule.atoms
    )
    product_atoms = Counter(
        atom.element
        for molecule in products.molecules
        for atom in molecule.atoms
    )
    return reactant_atoms == product_atoms


def sort_atoms_into_buckets(reaction_side: Reactants | Products) -> list[Bucket]:
    """Group every atom on one reaction side into element-specific buckets.

    Each bucket atom retains both its molecule and atom IDs, since atom IDs
    are only guaranteed to be unique inside an individual molecule.
    """
    buckets: dict[str, Bucket] = {}
    for molecule in reaction_side.molecules:
        for atom in molecule.atoms:
            bucket = buckets.setdefault(atom.element, Bucket(atom.element, []))
            bucket.atoms.append(BucketAtom(molecule.molecule_id, atom.id))
    return list(buckets.values())


def map_atoms(reactants: Reactants, products: Products) -> dict[AtomRef, AtomRef]:
    """Map every conserved reactant atom to a product atom with RDKit.

    RDKit first identifies the maximum bond-preserving common substructure.
    Those atom pairs anchor a deterministic, element-constrained assignment
    for atoms at the reaction centre and in any remaining components. The
    public result contains only stable MechVis atom references; RDKit indices
    never escape the backend service boundary.
    """
    if not validate_reaction(reactants, products):
        raise ValueError("Reactants and products must contain exactly the same atoms")

    rdkit_reactants = to_rdkit_reaction_side(reactants)
    rdkit_products = to_rdkit_reaction_side(products)
    if not rdkit_reactants.atom_refs:
        return {}

    rdkit_mapping = _map_rdkit_atoms(rdkit_reactants, rdkit_products)
    ordered_mapping = {
        reactant_index: rdkit_mapping[reactant_index]
        for reactant_index in range(len(rdkit_reactants.atom_refs))
    }
    return from_rdkit_atom_mapping(rdkit_reactants, rdkit_products, ordered_mapping)


def _map_rdkit_atoms(
    reactants: RDKitReactionSide,
    products: RDKitReactionSide,
) -> dict[int, int]:
    reactant_molecule = reactants.molecule
    product_molecule = products.molecule
    mapping = _maximum_common_substructure_mapping(reactant_molecule, product_molecule)
    used_product_indices = set(mapping.values())

    remaining_by_element: dict[int, tuple[list[int], list[int]]] = {}
    atomic_numbers = {
        atom.GetAtomicNum()
        for atom in reactant_molecule.GetAtoms()
        if atom.GetIdx() not in mapping
    }
    for atomic_number in atomic_numbers:
        reactant_indices = [
            atom.GetIdx()
            for atom in reactant_molecule.GetAtoms()
            if atom.GetIdx() not in mapping and atom.GetAtomicNum() == atomic_number
        ]
        product_indices = [
            atom.GetIdx()
            for atom in product_molecule.GetAtoms()
            if atom.GetIdx() not in used_product_indices and atom.GetAtomicNum() == atomic_number
        ]
        if len(reactant_indices) != len(product_indices):
            raise ValueError("RDKit could not create an element-preserving atom mapping")
        remaining_by_element[atomic_number] = (reactant_indices, product_indices)

    # Rare elements provide useful anchors for repeated C/H atoms. Hydrogen is
    # intentionally assigned last so its attached heavy-atom mapping can guide
    # equivalent-hydrogen choices.
    group_order = sorted(
        remaining_by_element,
        key=lambda number: (
            number == 1,
            len(remaining_by_element[number][0]),
            number,
        ),
    )
    for atomic_number in group_order:
        reactant_indices, product_indices = remaining_by_element[atomic_number]
        scores = [
            [
                _atom_pair_score(
                    reactant_molecule,
                    reactant_index,
                    product_molecule,
                    product_index,
                    mapping,
                )
                for product_index in product_indices
            ]
            for reactant_index in reactant_indices
        ]
        for row, column in _maximum_weight_assignment(scores):
            mapping[reactant_indices[row]] = product_indices[column]

    if len(mapping) != reactant_molecule.GetNumAtoms():
        raise RuntimeError("RDKit returned an incomplete atom mapping")
    return mapping


def _maximum_common_substructure_mapping(
    reactant_molecule: Chem.Mol,
    product_molecule: Chem.Mol,
) -> dict[int, int]:
    """Return the most locally similar match of RDKit's conserved scaffold."""
    mcs = rdFMCS.FindMCS(
        [reactant_molecule, product_molecule],
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrder,
        ringMatchesRingOnly=True,
        completeRingsOnly=True,
        matchChiralTag=True,
        timeout=5,
    )
    if mcs.numAtoms == 0:
        return {}

    query = Chem.MolFromSmarts(mcs.smartsString)
    if query is None:
        return {}
    reactant_matches = reactant_molecule.GetSubstructMatches(
        query,
        uniquify=False,
        useChirality=True,
        maxMatches=256,
    )
    product_matches = product_molecule.GetSubstructMatches(
        query,
        uniquify=False,
        useChirality=True,
        maxMatches=256,
    )
    if not reactant_matches or not product_matches:
        return {}

    best_score: int | None = None
    best_pairs: tuple[tuple[int, int], ...] = ()
    for reactant_match in reactant_matches:
        for product_match in product_matches:
            pairs = tuple(zip(reactant_match, product_match))
            score = sum(
                _atom_pair_score(
                    reactant_molecule,
                    reactant_index,
                    product_molecule,
                    product_index,
                    {},
                )
                for reactant_index, product_index in pairs
            )
            if (
                best_score is None
                or score > best_score
                or (score == best_score and pairs < best_pairs)
            ):
                best_score = score
                best_pairs = pairs
    return dict(best_pairs)


def _atom_pair_score(
    reactant_molecule: Chem.Mol,
    reactant_index: int,
    product_molecule: Chem.Mol,
    product_index: int,
    known_mapping: dict[int, int],
) -> int:
    """Score local chemical similarity and consistency with known atom pairs."""
    reactant_atom = reactant_molecule.GetAtomWithIdx(reactant_index)
    product_atom = product_molecule.GetAtomWithIdx(product_index)
    if reactant_atom.GetAtomicNum() != product_atom.GetAtomicNum():
        return -1_000_000

    score = 100
    score += 40 if reactant_atom.GetFormalCharge() == product_atom.GetFormalCharge() else -40
    score += 25 if reactant_atom.GetDegree() == product_atom.GetDegree() else -12 * abs(
        reactant_atom.GetDegree() - product_atom.GetDegree()
    )
    score += 10 if reactant_atom.IsInRing() == product_atom.IsInRing() else -10

    reactant_neighbors = _neighbor_signature(reactant_atom)
    product_neighbors = _neighbor_signature(product_atom)
    common_neighbors = reactant_neighbors & product_neighbors
    score += 20 * sum(common_neighbors.values())
    score -= 8 * (
        sum((reactant_neighbors - product_neighbors).values())
        + sum((product_neighbors - reactant_neighbors).values())
    )

    for mapped_reactant, mapped_product in known_mapping.items():
        reactant_bond = reactant_molecule.GetBondBetweenAtoms(reactant_index, mapped_reactant)
        product_bond = product_molecule.GetBondBetweenAtoms(product_index, mapped_product)
        if reactant_bond is None and product_bond is None:
            continue
        if reactant_bond is None or product_bond is None:
            score -= 50
        elif reactant_bond.GetBondType() == product_bond.GetBondType():
            score += 100
        else:
            score += 25
    return score


def _neighbor_signature(atom: Chem.Atom) -> Counter[tuple[int, float]]:
    return Counter(
        (
            neighbor.GetAtomicNum(),
            atom.GetOwningMol()
            .GetBondBetweenAtoms(atom.GetIdx(), neighbor.GetIdx())
            .GetBondTypeAsDouble(),
        )
        for neighbor in atom.GetNeighbors()
    )


def _maximum_weight_assignment(scores: list[list[int]]) -> list[tuple[int, int]]:
    """Solve a square maximum-weight assignment with the Hungarian algorithm."""
    if not scores:
        return []
    size = len(scores)
    if any(len(row) != size for row in scores):
        raise ValueError("Atom assignment matrix must be square")

    maximum = max(max(row) for row in scores)
    costs = [[maximum - score for score in row] for row in scores]
    row_potentials = [0] * (size + 1)
    column_potentials = [0] * (size + 1)
    assigned_rows = [0] * (size + 1)
    path = [0] * (size + 1)

    for row in range(1, size + 1):
        assigned_rows[0] = row
        column = 0
        minimums = [float("inf")] * (size + 1)
        used = [False] * (size + 1)
        while True:
            used[column] = True
            current_row = assigned_rows[column]
            delta = float("inf")
            next_column = 0
            for candidate_column in range(1, size + 1):
                if used[candidate_column]:
                    continue
                reduced_cost = (
                    costs[current_row - 1][candidate_column - 1]
                    - row_potentials[current_row]
                    - column_potentials[candidate_column]
                )
                if reduced_cost < minimums[candidate_column]:
                    minimums[candidate_column] = reduced_cost
                    path[candidate_column] = column
                if minimums[candidate_column] < delta:
                    delta = minimums[candidate_column]
                    next_column = candidate_column
            for candidate_column in range(size + 1):
                if used[candidate_column]:
                    row_potentials[assigned_rows[candidate_column]] += delta
                    column_potentials[candidate_column] -= delta
                else:
                    minimums[candidate_column] -= delta
            column = next_column
            if assigned_rows[column] == 0:
                break
        while True:
            previous_column = path[column]
            assigned_rows[column] = assigned_rows[previous_column]
            column = previous_column
            if column == 0:
                break

    return sorted(
        (assigned_rows[column] - 1, column - 1)
        for column in range(1, size + 1)
    )


def find_backbone(molecule):
    """Return the longest non-H path starting at the first end atom.

    At each intersection, every forward branch is walked recursively.  When
    branches have the same length, the branch encountered last in the
    molecule's bond order is selected.
    """
    ends = find_ends(molecule)
    if not ends:
        return []

    atoms_by_id = {atom.id: atom for atom in molecule.atoms}
    non_h_neighbours = {atom.id: [] for atom in molecule.atoms if atom.is_non_h()}

    for bond in molecule.bonds:
        atom1 = atoms_by_id[bond.atom1_id]
        atom2 = atoms_by_id[bond.atom2_id]

        if atom1.is_non_h() and atom2.is_non_h():
            non_h_neighbours[atom1.id].append(atom2)
            non_h_neighbours[atom2.id].append(atom1)

    def walk(atom, last_atom):
        path = [atom]
        next_atoms = [
            neighbour
            for neighbour in non_h_neighbours[atom.id]
            if last_atom is None or neighbour.id != last_atom.id
        ]

        if len(next_atoms) == 1:
            return path + walk(next_atoms[0], atom)

        if len(next_atoms) > 1:
            longest_branch = []
            for next_atom in next_atoms:
                branch = walk(next_atom, atom)
                if len(branch) >= len(longest_branch):
                    longest_branch = branch
            return path + longest_branch

        return path

    return walk(ends[0], None)


def find_ends(molecule):
    """Return non-H atoms connected to exactly one other heavy atom."""
    atoms_by_id = {atom.id: atom for atom in molecule.atoms}
    non_h_bond_counts = {atom.id: 0 for atom in molecule.atoms if atom.is_non_h()}

    for bond in molecule.bonds:
        atom1 = atoms_by_id[bond.atom1_id]
        atom2 = atoms_by_id[bond.atom2_id]

        if atom1.is_non_h() and atom2.is_non_h():
            non_h_bond_counts[atom1.id] += 1
            non_h_bond_counts[atom2.id] += 1

    return [atom for atom in molecule.atoms if non_h_bond_counts.get(atom.id) == 1]


def find_non_h_atoms(molecule):
    """Return all atoms except hydrogen atoms."""
    return [atom for atom in molecule.atoms if atom.is_non_h()]
