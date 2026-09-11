"""Small RDKit adapter used by the chemistry validation layer."""

from rdkit import Chem


_PERIODIC_TABLE = Chem.GetPeriodicTable()


def is_valid_element_symbol(symbol: str) -> bool:
    """Return whether *symbol* is an element known to RDKit."""
    try:
        return _PERIODIC_TABLE.GetAtomicNumber(symbol) > 0
    except (RuntimeError, ValueError):
        return False
