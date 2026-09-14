import assert from "node:assert/strict";
import test from "node:test";

import { formulaFromAtoms } from "../../src/frontend/src/moleculeFormula.ts";

test("molecular formulas include inferred and explicit hydrogens", () => {
  assert.deepEqual(
    formulaFromAtoms([
      { symbol: "C", implicitHydrogens: 3 },
      { symbol: "C", implicitHydrogens: 2 },
      { symbol: "O", implicitHydrogens: 0 },
      { symbol: "H", implicitHydrogens: 0 },
    ]),
    [
      { symbol: "C", count: 2 },
      { symbol: "H", count: 6 },
      { symbol: "O", count: 1 },
    ],
  );
});
