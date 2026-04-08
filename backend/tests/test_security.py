"""Tests for app.security — connection tracker, rate checker, config."""

import time

from app.security import ConnectionTracker, WSRateChecker


# ---------------------------------------------------------------------------
# ConnectionTracker
# ---------------------------------------------------------------------------


class TestConnectionTracker:
    def test_basic_connect_disconnect(self):
        ct = ConnectionTracker(max_connections=3)
        assert ct.count == 0
        assert ct.try_connect("a") is True
        assert ct.count == 1
        ct.disconnect("a")
        assert ct.count == 0

    def test_rejects_at_capacity(self):
        ct = ConnectionTracker(max_connections=2)
        assert ct.try_connect("a") is True
        assert ct.try_connect("b") is True
        assert ct.try_connect("c") is False  # rejected
        assert ct.count == 2

    def test_disconnect_frees_slot(self):
        ct = ConnectionTracker(max_connections=2)
        ct.try_connect("a")
        ct.try_connect("b")
        ct.disconnect("a")
        assert ct.try_connect("c") is True
        assert ct.count == 2

    def test_disconnect_unknown_id_is_safe(self):
        ct = ConnectionTracker(max_connections=5)
        ct.disconnect("nonexistent")  # should not raise
        assert ct.count == 0


# ---------------------------------------------------------------------------
# WSRateChecker
# ---------------------------------------------------------------------------


class TestWSRateChecker:
    def test_allows_within_limit(self):
        rc = WSRateChecker(max_per_second=5)
        for _ in range(5):
            assert rc.check() is True

    def test_blocks_over_limit(self):
        rc = WSRateChecker(max_per_second=3)
        assert rc.check() is True
        assert rc.check() is True
        assert rc.check() is True
        assert rc.check() is False  # 4th in same second

    def test_window_resets(self):
        rc = WSRateChecker(max_per_second=2)
        rc.check()
        rc.check()
        assert rc.check() is False
        # Simulate 1 second passing by manipulating timestamps
        rc._timestamps = [t - 1.1 for t in rc._timestamps]
        assert rc.check() is True  # window expired


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


class TestConfig:
    def test_defaults_loaded(self):
        from app import config
        assert isinstance(config.ALLOWED_ORIGINS, list)
        assert len(config.ALLOWED_ORIGINS) > 0
        assert config.HTTP_RATE_LIMIT > 0
        assert config.WS_MSG_RATE_LIMIT > 0
        assert config.MAX_WS_CONNECTIONS > 0
        assert config.MAX_WS_MESSAGE_BYTES > 0
