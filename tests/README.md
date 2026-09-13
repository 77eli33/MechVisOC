# Backend test overview

Run from the repository root: `.venv/bin/python -m pytest tests/backend`.

- `backend/test_model.py`: internal molecule data structures and editor molecule
  validation, including explicit formal charge handling.
- `backend/test_rdkit_service.py`: RDKit adapters, identity preservation, graph
  validation and closed-shell, explicit-H electron configuration checks.
- `backend/test_mapping.py`: reaction conservation, element-preserving atom
  mapping, canonical bond differences and bond order changes.
- `backend/test_api.py`: API input/output contracts and validation errors.
- `backend/test_electron_flow_api.py`: protonation endpoint with one shared mapping,
  reactant-side source/sink references, unsupported bookkeeping input and reaction
  conservation errors, legacy skeleton mapping compatibility, and serialization
  of ambiguous/conflicting results including remaining-site candidate indices.
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
are not enumerated. Domain tests remain independent of the API and frontend.
The dedicated `/api/electron-flow` endpoint accepts already editor-validated
molecules and returns the mapping plus classified sites and tracking results;
it does not repeat molecule validation. `/api/atom-mapping` retains its existing
less restrictive behavior for structural skeletons. API candidates index the
`remaining.sources` and `remaining.sinks` arrays, and all pair locations use
reactant-side molecule/atom references.

## Frontend presentation tests

Run `node --test tests/frontend/*.test.mjs` from the repository root with Node
22.18+ (native TypeScript stripping), then `npm run build` in
`src/frontend` for type checking and the production bundle.

`frontend/electron_flow_layout.test.mjs` checks deterministic HBr placement,
cardinal existing bonds, grid-aligned new contacts, molecule separation,
free-face donor approach without crossing an existing H or bond,
orthogonal arrow tangents, exclusion of bond-occupied lone-pair ports,
conflict/partial-ambiguity rendering selection, one arrow per transferred pair,
translation-invariant centering,
and accessible overflow bounds. Diagonal existing geometry is intentionally
reported as unsupported; only new dashed bonds can be diagonal. These are
presentation rules, not additional mechanism or chemical-validity tests.

`frontend/molecule_editor_geometry.test.mjs` checks that editor attachment slots
stay cardinal, occupied positions are excluded, arrow navigation is based on
visual geometry rather than target ordering, and formal-charge labels use the
same magnitude-before-sign convention as the electron-flow scene.
