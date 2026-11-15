"""Minimal async-safe circuit breaker.

closed     -> calls pass; consecutive failures are counted
open       -> calls are short-circuited (fallback immediately) until `reset_timeout_sec` elapses
half_open  -> exactly one trial call is let through; success closes, failure re-opens
"""
import time
from collections.abc import Callable
from dataclasses import dataclass

CLOSED, OPEN, HALF_OPEN = "closed", "open", "half_open"


@dataclass
class BreakerSnapshot:
    state: str
    failures: int
    last_error: str | None
    retry_in_sec: float | None


class CircuitBreaker:
    def __init__(self, name: str, failure_threshold: int, reset_timeout_sec: float,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.name = name
        self.failure_threshold = max(1, failure_threshold)
        self.reset_timeout_sec = reset_timeout_sec
        self.clock = clock
        self.state = CLOSED
        self.failures = 0
        self.opened_at: float | None = None
        self.last_error: str | None = None
        self._trial_in_flight = False

    def allow(self) -> bool:
        """May a call to the protected dependency be attempted now?"""
        if self.state == CLOSED:
            return True
        if self.state == OPEN:
            if self.opened_at is not None and self.clock() - self.opened_at >= self.reset_timeout_sec:
                self.state = HALF_OPEN
                self._trial_in_flight = False
            else:
                return False
        # half-open: a single trial at a time
        if self._trial_in_flight:
            return False
        self._trial_in_flight = True
        return True

    def record_success(self) -> bool:
        """Returns True if the breaker changed state (i.e. it recovered)."""
        changed = self.state != CLOSED
        self.state, self.failures, self.opened_at, self._trial_in_flight = CLOSED, 0, None, False
        return changed

    def record_failure(self, error: str) -> bool:
        """Returns True if the breaker just opened."""
        self.last_error = error[:300]
        self.failures += 1
        self._trial_in_flight = False
        if self.state == HALF_OPEN or (self.state == CLOSED and self.failures >= self.failure_threshold):
            self.state, self.opened_at = OPEN, self.clock()
            return True
        return False

    def force(self, state: str, last_error: str | None = None) -> None:
        """Adopt a state announced by another worker (no event re-emission)."""
        if state == OPEN and self.state != OPEN:
            self.state, self.opened_at, self._trial_in_flight = OPEN, self.clock(), False
            self.failures = max(self.failures, self.failure_threshold)
            self.last_error = last_error or self.last_error
        elif state == CLOSED and self.state != CLOSED:
            self.record_success()

    def snapshot(self) -> BreakerSnapshot:
        retry = None
        if self.state == OPEN and self.opened_at is not None:
            retry = round(max(0.0, self.reset_timeout_sec - (self.clock() - self.opened_at)), 1)
        return BreakerSnapshot(self.state, self.failures, self.last_error, retry)
