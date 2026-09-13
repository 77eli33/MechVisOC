"""Electron-flow transport schema; every location uses reactant atom references."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from .api import AtomMappingResponse, BucketAtomPayload
from .chemistry.electron_balance import PairBalance
from .chemistry.electron_flow import FlowResult


class PairSitePayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # One atom identifies nonbonding pairs; two identify a bond location.
    atoms: list[BucketAtomPayload]
    pair_count: int


class PairBalancePayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sources: list[PairSitePayload]
    sinks: list[PairSitePayload]


class PairFlowPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: PairSitePayload
    sink: PairSitePayload
    pair_count: int


class ElectronFlowPayload(PairBalancePayload):
    flows: list[PairFlowPayload]
    remaining: PairBalancePayload
    # Each index pair refers to remaining.sources and remaining.sinks.
    candidates: list[tuple[int, int]]
    status: Literal["complete", "ambiguous", "conflict"]
    reason: str | None


class ElectronFlowResponse(AtomMappingResponse):
    electron_flow: ElectronFlowPayload


def serialize_electron_flow(balance: PairBalance, result: FlowResult) -> ElectronFlowPayload:
    return ElectronFlowPayload(
        sources=balance.sources,
        sinks=balance.sinks,
        flows=result.flows,
        remaining=result.remaining,
        candidates=result.candidates,
        status=result.status,
        reason=result.reason,
    )
