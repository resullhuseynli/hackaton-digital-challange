from fastapi import APIRouter, Depends

from app.i18n import language_params, localize_labels
from app.schemas.geo import RoutingStatusOut
from app.services.routing_gateway import routing_gateway

router = APIRouter(prefix="/routing", tags=["routing"])


@router.get("/status", response_model=RoutingStatusOut,
            summary="Health of the external map & routing API and the active routing mode",
            description="`status: fallback` means the external provider is unavailable (HTTP 5xx / >5 s timeout) "
                        "and routes are served from the local backup (road graph, cached routes, static matrix). "
                        "Show `notice.text` (\"Oflayn/Ehtiyat marşrut rejimində işləyir\") to the user. "
                        "Changes are also pushed as the `routing.status` WebSocket event.")
async def routing_status(lang: str = Depends(language_params)):
    return localize_labels(routing_gateway.status(), lang)
