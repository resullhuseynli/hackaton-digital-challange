from fastapi import APIRouter, Depends

from app.api.v1 import alerts, assembly_points, auth, brigades, citizens, dispatch, routes, routing, sim, sos, zones
from app.i18n import language_params

# language_params documents `Accept-Language` / `?lang=` on every endpoint in the OpenAPI docs
api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(language_params)])
for module in (auth, citizens, routes, routing, zones, assembly_points, sos, dispatch, brigades, alerts, sim):
    api_router.include_router(module.router)
