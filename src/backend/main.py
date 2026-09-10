from chemistry.model import Atom, Bond, Molecule


molecule = Molecule("Bromoethane")

molecule.add_atom(Atom(0, "C"))
molecule.add_atom(Atom(1, "C"))
molecule.add_atom(Atom(2, "Br"))

molecule.add_bond(Bond(0, 1))
molecule.add_bond(Bond(1, 2))

print(molecule.name)

for atom in molecule.atoms:
    print(atom.id, atom.element)

for bond in molecule.bonds:
    print(bond.atom1_id, "-", bond.atom2_id)