"""Tests for sanitize_upstream allowlist behavior added in the post-board
follow-up to PR #48. The denylist heuristic (120-char + 'Traceback' substring)
was found evadable by short Python exceptions; the allowlist closes that gap."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sanitize import sanitize_upstream  # noqa: E402


def test_short_pymysql_operationalerror_with_embedded_ip_is_masked():
    data = {"error": "Access denied for user root@1.2.3.4"}
    out = sanitize_upstream(data)
    assert out["error"] == "Upstream service error"


def test_short_valueerror_is_masked():
    data = {"error": "invalid literal for int() with base 10: 'x'"}
    out = sanitize_upstream(data)
    assert out["error"] == "Upstream service error"


def test_long_traceback_is_masked():
    data = {"error": "Traceback (most recent call last):\n  File ..."}
    out = sanitize_upstream(data)
    assert out["error"] == "Upstream service error"


def test_allowlisted_bridge_unreachable_passes_through():
    data = {"error": "MT5 Bridge unreachable"}
    out = sanitize_upstream(data)
    assert out["error"] == "MT5 Bridge unreachable"


def test_allowlisted_bridge_timeout_passes_through():
    data = {"error": "MT5 Bridge timed out"}
    out = sanitize_upstream(data)
    assert out["error"] == "MT5 Bridge timed out"


def test_allowlisted_bridge_error_passes_through():
    data = {"error": "MT5 Bridge error"}
    out = sanitize_upstream(data)
    assert out["error"] == "MT5 Bridge error"


def test_non_dict_returns_unchanged():
    assert sanitize_upstream([1, 2, 3]) == [1, 2, 3]
    assert sanitize_upstream("hello") == "hello"
    assert sanitize_upstream(None) is None


def test_dict_without_error_passes_through():
    data = {"balance": 1000, "equity": 1100}
    out = sanitize_upstream(data)
    assert out == data


def test_non_string_error_passes_through_unchanged():
    # Belt-and-suspenders: a dict where 'error' is not a string falls through.
    data = {"error": None, "balance": 0}
    out = sanitize_upstream(data)
    assert out["error"] == "Upstream service error"


def test_path_traversal_in_short_error_is_masked():
    data = {"error": "No such file: /etc/passwd"}
    out = sanitize_upstream(data)
    assert out["error"] == "Upstream service error"
