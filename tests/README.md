# Backend test overview

Run from the repository root: `.venv/bin/python -m pytest tests/backend`.

- `backend/test_model.py`: internal molecule data structures and editor molecule
  validation, including explicit formal charge handling.
- `backend/test_rdkit_service.py`: RDKit adapters, identity preservation, graph
  validation and closed-shell, explicit-H electron configuration checks.
- `backend/test_mapping.py`: reaction conservation, element-preserving atom
  mapping, canonical bond differences and bond order changes.
- `backend/test_api.py`: API input/output contracts and validation errors.
- `backend/test_electron_flow.py`: formal lone-pair counts (O, Br, H, CH3+ and
  CH3-), unsupported odd/negative electron counts and elements, graph/mapping
  prerequisites, alkene/HBr protonation through the existing automatic mapper,
  hydroxide substitution, reversed protonation (charge decrease alone creates
  no lone-pair sink), multi-order pair capacities, forced assignments, partial
  and full ambiguity, conflicts and empty/duplicate input.

## Electron-flow assumptions

The new domain functions consume already validated molecules. All hydrogens
must be explicit; radicals, aromatic/fractional bonds and transition-metal
counting are outside this first implementation. The supported main-group
symbols are explicitly listed in `electron_balance.py`. Formal lone-pair
counting is an electron accounting identity, not a new molecule-validity or
stability test: an even nonnegative result does not prove a closed-shell state.
For example, a bare neutral C formally yields two pairs by this arithmetic,
although editor validation rejects that input. Existing `Atom.electron_count`
and `proton_count` metadata do not override element/formal-charge bookkeeping.

Charge differences enter only through the change of nonbonding pairs. Bond
order changes carry their full pair count. Pair tracking consumes separately
classified sources/sinks, links sites sharing an atom, checks capacity
feasibility and resolves only forced single-candidate assignments. Feasible
remaining graphs are conservatively labelled ambiguous, even if a stronger
solver could establish additional constraints. Completion means structural
pair balance under this rule, not proof of an actual or unique mechanism.
Results also depend on the supplied/chosen atom mapping; mapping alternatives
are not enumerated. No API or frontend integration is assumed by these tests.
