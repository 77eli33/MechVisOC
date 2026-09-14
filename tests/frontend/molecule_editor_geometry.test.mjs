import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFormalCharge,
  freeSlots,
  nextNavigationTarget,
  removeAtomAndDisconnectedBranches,
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

test("removing a bridge atom also removes branches disconnected from the established structure", () => {
  const atoms = [
    { id: "root", x: 0, y: 0 },
    { id: "bridge", x: 1, y: 0 },
    { id: "branch-a", x: 2, y: 0 },
    { id: "branch-b", x: 2, y: 1 },
  ];
  const bonds = [
    { from: "root", to: "bridge", order: 1 },
    { from: "bridge", to: "branch-a", order: 1 },
    { from: "bridge", to: "branch-b", order: 1 },
  ];

  assert.deepEqual(removeAtomAndDisconnectedBranches("bridge", atoms, bonds), {
    atoms: [atoms[0]],
    bonds: [],
  });
});

test("removing a terminal atom preserves the connected remainder", () => {
  const atoms = [
    { id: "root", x: 0, y: 0 },
    { id: "middle", x: 1, y: 0 },
    { id: "leaf", x: 2, y: 0 },
  ];
  const bonds = [
    { from: "root", to: "middle", order: 1 },
    { from: "middle", to: "leaf", order: 1 },
  ];

  assert.deepEqual(removeAtomAndDisconnectedBranches("leaf", atoms, bonds), {
    atoms: atoms.slice(0, 2),
    bonds: bonds.slice(0, 1),
  });
});
