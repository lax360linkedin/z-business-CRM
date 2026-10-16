"""One error shape for the whole API, the one the React app already reads:  { "message": str, "code": str, "fields"?: { field: message } }."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")


class ApiError(Exception):
    """Raise from services / routers for an expected failure."""

    def __init__(self, status: int, message: str, code: str = "ERROR", fields: dict | None = None, extra: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.code, self.fields, self.extra = status, message, code, fields, extra or {}


def bad_request(message: str, fields: dict | None = None, code: str = "BAD_REQUEST") -> ApiError:
    return ApiError(400, message, code, fields)


def invalid(message: str, fields: dict | None = None) -> ApiError:
    return ApiError(422, message, "VALIDATION_ERROR", fields)


def unauthorized(message: str = "Not signed in.", code: str = "UNAUTHENTICATED") -> ApiError:
    return ApiError(401, message, code)


def forbidden(message: str = "You do not have permission to do that.") -> ApiError:
    return ApiError(403, message, "FORBIDDEN")


def not_found(message: str = "Not found.") -> ApiError:
    return ApiError(404, message, "NOT_FOUND")


def conflict(message: str, fields: dict | None = None, code: str = "CONFLICT") -> ApiError:
    return ApiError(409, message, code, fields)


def _body(message: str, code: str, fields: dict | None = None, extra: dict | None = None) -> dict:
    out = {"message": message, "code": code}
    if fields:
        out["fields"] = fields
    if extra:
        out.update(extra)
    return out


def unhandled_response() -> JSONResponse:
    """The answer to an error nobody anticipated. Used by the request middleware (which sits INSIDE the CORS layer, so the browser can read this answer) and as the last-resort handler."""
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content=_body("Something went wrong on the server.", "INTERNAL_ERROR"))


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content=_body(exc.message, exc.code, exc.fields, exc.extra))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        fields = {}
        for err in exc.errors():
            loc = [str(p) for p in err["loc"] if p not in ("body", "query", "path")]
            fields[".".join(loc) or "request"] = err["msg"]
        first = next(iter(fields.values()), "Invalid request.")
        return JSONResponse(status_code=422, content=_body(first, "VALIDATION_ERROR", fields))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        codes = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 429: "RATE_LIMITED"}
        return JSONResponse(status_code=exc.status_code, content=_body(str(exc.detail), codes.get(exc.status_code, "ERROR")))

    @app.exception_handler(OperationalError)
    async def _database_unavailable(_: Request, exc: OperationalError):
        # Connection / authentication problems. The driver text can carry host and user details: log the class only, return nothing.
        log.error("database unavailable: %s", type(exc.orig).__name__ if exc.orig is not None else "OperationalError")
        return JSONResponse(status_code=503, content=_body("The service is temporarily unavailable. Please try again in a moment.", "DATABASE_UNAVAILABLE"))

    @app.exception_handler(DataError)
    async def _bad_data(_: Request, exc: DataError):
        log.warning("database rejected a value: %s", type(exc.orig).__name__ if exc.orig is not None else "DataError")
        return JSONResponse(status_code=422, content=_body("One of the values is too long or is not in an accepted format.", "VALIDATION_ERROR"))

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        log.warning("integrity error: %s", exc.orig)
        return JSONResponse(status_code=409, content=_body("That change conflicts with existing data (a duplicate, or a record that is still in use).", "CONFLICT"))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        return unhandled_response()
