# AGENTS.md

## Project

MechVis is a local application for visualizing chemical reaction mechanisms.

The project is split into a frontend and a Python backend. Chemistry domain logic belongs in the backend and is based on MechVis' own internal chemistry model.

Agents should inspect the existing repository structure and relevant code before making changes rather than relying only on this document.

## General Working Principles

- Keep changes focused on the requested task.
- Do not modify unrelated code unless necessary for the requested change.
- Prefer small, understandable changes over broad refactors.
- Respect the existing architecture, naming conventions, patterns, and project structure.
- Do not introduce new dependencies unless they provide a clear benefit.
- Do not create abstractions before they are useful.
- Do not commit, push, merge, or otherwise modify Git history unless explicitly requested.
- Do not weaken tests, validation, or error handling merely to make an implementation pass.
- Run relevant tests and checks after making changes when possible.

## Decision Making and Clarification

Do not ask for clarification about minor implementation details that can reasonably be inferred from the existing codebase.

Make routine implementation decisions independently.

Ask before making decisions that materially affect:

- product behavior
- chemistry semantics
- application architecture
- API contracts
- persistent data structures
- UI or UX design

If an assumption is necessary, make it explicit.

Chemistry-related assumptions and simplifications should be documented where they affect implementation or tests.

## Architecture

Maintain a strict separation between frontend and backend.

Frontend/backend communication must happen through the defined API.

Do not:

- directly access backend internals from the frontend
- move chemistry domain logic into the frontend
- duplicate backend business logic in the frontend
- create shortcuts that bypass the API boundary

Keep responsibilities clearly separated between UI, API, application logic, and chemistry domain logic.

## Chemistry Model

MechVis' own chemistry model is the source of truth for application and chemistry logic.

Use the internal model for:

- atoms
- bonds
- molecules
- reaction-related logic
- comparisons and transformations
- other domain-level operations

RDKit should not become the application's primary domain model.

Use RDKit only for small, clearly scoped jobs where an established chemistry toolkit provides a meaningful advantage.

When RDKit is required:

1. Convert the relevant internal model data to an RDKit representation.
2. Perform the specific operation.
3. Convert or map the result back where necessary.

Keep RDKit-specific code isolated from the core domain model where practical.

## Python Code Structure

Keep modules reasonably small and focused.

If a Python file begins accumulating multiple unrelated responsibilities, split those responsibilities into appropriate modules.

Avoid large monolithic functions.

Prefer:

- small functions with clear responsibilities
- descriptive names
- helper functions for distinct operations
- composition of simple operations
- explicit data flow

A function should generally do one conceptual job.

Do not split code merely to satisfy arbitrary line-count limits. Readability and responsibility boundaries are more important than file or function length alone.

## Comments

Code comments are primarily intended to preserve context for future developers and AI agents.

Comments should explain:

- intent
- non-obvious reasoning
- architectural constraints
- chemistry assumptions
- important invariants
- reasons behind unusual implementation decisions

Do not comment trivial code that is already self-explanatory.

Prefer explaining *why* something is implemented a certain way rather than restating *what* the code does.

## Tests

Add or update tests when changing behavior or introducing domain logic.

Tests should cover relevant normal cases, edge cases, and important failure cases.

Maintain documentation in the tests directory that gives an overview of the test suite.

The overview should make it possible to understand:

- what areas are tested
- what important cases are covered
- what assumptions the tests rely on
- where the relevant tests are located

Update this documentation when test coverage meaningfully changes.

Do not change expected results solely to make failing tests pass. Determine whether the implementation, the test, or the underlying assumption is incorrect.

## UI and Frontend

Treat the existing UI design and supplied design references as authoritative.

Do not invent additional UI elements or content unless required by the task.

In particular, do not add unnecessary:

- explanatory text
- labels
- buttons
- cards or containers
- icons
- decorative elements
- gradients
- effects
- helper messages

Do not "improve" or redesign an existing interface unless explicitly requested.

Reuse existing components, styles, spacing conventions, and design patterns where possible.

Keep UI implementation faithful to the provided design rather than substituting generic framework or AI-generated design conventions.

## Code Hygiene

Keep the codebase understandable and avoid duplicate, obsolete, or unused implementations.

When duplicate, dead, obsolete, or apparently unused code is encountered while working on a task:

- point it out
- explain briefly why it appears unnecessary
- do not perform unrelated cleanup unless requested

Do not scan the entire repository for cleanup opportunities during ordinary tasks.

Repository-wide cleanup, dead-code analysis, duplication analysis, or architectural auditing should only be performed when explicitly requested.

## Scope Discipline

For normal tasks, inspect enough surrounding code to understand the relevant context and dependencies, but keep investigation proportional to the task.

Do not turn a small implementation request into a repository-wide refactor or audit.

If a larger architectural issue directly blocks or undermines the requested implementation, report it and explain the implications before expanding the scope.