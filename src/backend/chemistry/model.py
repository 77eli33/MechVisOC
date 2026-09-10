class Atom:
    def __init__(self, atom_id, element, formal_charge = 0):
        self.id = atom_id
        self.element = element
        self.formal_charge = formal_charge

    def is_non_h(self):
        if self.element is None:
            raise ValueError("Atom has no element")

        if self.element == "H":
            return False

        return True
    

class Bond:
    def __init__(self, atom1_id, atom2_id, order = 1):
        self.atom1_id = atom1_id
        self.atom2_id = atom2_id
        self.order = order


class Molecule:
    def __init__(self, molecule_id, name):
        self.molecule_id = molecule_id
        self.name = name
        self.atoms = []
        self.bonds = []

    def add_atom(self,atom):
        self.atoms.append(atom)

    def add_bond(self,bond):
        self.bonds.append(bond)