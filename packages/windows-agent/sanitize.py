"""Allowlist-based sanitizer for upstream JSON responses forwarded by the
Windows agent. Extracted from agent.py so the unit tests do not require Flask."""

_SAFE_PROXY_ERRORS = frozenset(
    {
        "MT5 Bridge unreachable",
        "MT5 Bridge timed out",
        "MT5 Bridge error",
    }
)


def sanitize_upstream(data):
    """Only proxy-emitted error strings pass through verbatim.
    Anything else in the `error` key is masked. Closes the denylist-evasion
    class (short Python exceptions <120 chars containing usernames/IPs/paths)
    flagged by the board review on PR #48."""
    if not isinstance(data, dict):
        return data
    if "error" in data and data["error"] not in _SAFE_PROXY_ERRORS:
        data = {**data, "error": "Upstream service error"}
    return data
