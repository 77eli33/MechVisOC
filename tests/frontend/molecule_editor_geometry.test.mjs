import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFormalCharge,
  freeSlots,
  nextNavigationTarget,
} from "../../src/frontend/src/moleculeEditorGeometry.ts";

test("free slots are cardinal and exclude occupied atom positions", () => {
  const parent = { id: "center", x: 0, y: 0 };
  const atoms = [
    parent,
    { id: "top", x: 0, y: -1 },
    { id: "right", x: 1, y: 0 },
    { id: "diagonal", x: -1, y: -1 },
  ];

  assert.deepEqual(
    freeSlots(parent, atoms).map(({ x, y, direction }) => [x, y, direction.key]),
    [[0, 1, "down"], [-1, 0, "left"]],
  );
});

test("arrow navigation follows geometry, independent of target order", () => {
  const current = { key: "atom:center", kind: "atom", x: 0, y: 0 };
  const directSlot = { key: "slot:center:right", kind: "slot", x: 1, y: 0 };
  const fartherAtom = { key: "atom:far", kind: "atom", x: 3, y: 0 };
  const diagonalAtom = { key: "atom:diagonal", kind: "atom", x: 1, y: -1 };

  for (const targets of [
    [current, directSlot, fartherAtom, diagonalAtom],
    [diagonalAtom, fartherAtom, current, directSlot],
  ]) {
    assert.equal(nextNavigationTarget(current, targets, { x: 1, y: 0 })?.key, directSlot.key);
    assert.equal(nextNavigationTarget(current, targets, { x: 0, y: -1 })?.key, diagonalAtom.key);
    assert.equal(nextNavigationTarget(current, targets, { x: -1, y: 0 }), null);
  }
});

test("formal charges use chemistry-style magnitude-before-sign labels", () => {
  assert.equal(formatFormalCharge(0), "");
  assert.equal(formatFormalCharge(1), "+");
  assert.equal(formatFormalCharge(-1), "−");
  assert.equal(formatFormalCharge(2), "2+");
  assert.equal(formatFormalCharge(-2), "2−");
});
