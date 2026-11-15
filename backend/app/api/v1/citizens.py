from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_citizen
from app.models import Citizen, SosSignal
from app.schemas.citizen import CitizenOut, CitizenRegister, LocationIn, StatusIn
from app.schemas.common import ErrorResponse
from app.services import antispam
from app.services.citizens import set_location
from app.services.serialize import citizen_out

router = APIRouter(prefix="/citizens", tags=["citizens"])
AUTH_ERRORS = {401: {"model": ErrorResponse, "description": "X-Device-Id yoxdur və ya qeydiyyatsızdır"}}


@router.post("/register", response_model=CitizenOut, summary="Register a device (idempotent)",
             dependencies=[Depends(antispam.limit_register)],
             description="Registration form fields: optional phone and the checkbox **Hərəkət məhdudiyyətli şəxs** "
                         "(`mobility_impaired`). SOS signals of such persons are always ranked first for "
                         "dispatchers and carry the `MOBILITY_IMPAIRED` label. Calling again updates the profile.")
async def register(body: CitizenRegister, request: Request, session: AsyncSession = Depends(get_session)):
    device_id = str(body.device_id)
    citizen = await session.scalar(select(Citizen).where(Citizen.device_id == device_id))
    if citizen is None:
        await antispam.note_registration(antispam.request_ip_hash(request))  # anti-spam signal
        citizen = Citizen(device_id=device_id, phone=body.phone, status="unknown",
                          mobility_impaired=bool(body.mobility_impaired))
        session.add(citizen)
    else:
        if body.phone:
            citizen.phone = body.phone
        if body.mobility_impaired is not None and body.mobility_impaired != citizen.mobility_impaired:
            citizen.mobility_impaired = body.mobility_impaired
            # keep the dispatcher queue consistent for SOS that are still open
            await session.execute(update(SosSignal).where(
                SosSignal.citizen_id == citizen.id, SosSignal.status != "resolved",
            ).values(citizen_mobility_impaired=body.mobility_impaired))
    await session.commit()
    await session.refresh(citizen)
    return citizen_out(citizen)


@router.patch("/me/location", response_model=CitizenOut, responses=AUTH_ERRORS)
async def update_location(body: LocationIn, citizen: Citizen = Depends(current_citizen),
                          session: AsyncSession = Depends(get_session)):
    await set_location(session, citizen, body.lat, body.lng)
    await session.commit()
    await session.refresh(citizen)
    return citizen_out(citizen)


@router.patch("/me/status", response_model=CitizenOut, responses=AUTH_ERRORS)
async def update_status(body: StatusIn, citizen: Citizen = Depends(current_citizen),
                        session: AsyncSession = Depends(get_session)):
    citizen.status = body.status
    await session.commit()
    await session.refresh(citizen)
    return citizen_out(citizen)
