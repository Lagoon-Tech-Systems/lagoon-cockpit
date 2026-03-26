import json
import time
import threading
from queue import Queue, Empty

_clients = []
_lock = threading.Lock()
MAX_CLIENTS = 50


def add_client():
    if len(_clients) >= MAX_CLIENTS:
        return None
    q = Queue(maxsize=100)
    with _lock:
        _clients.append(q)
    return q


def remove_client(q):
    with _lock:
        try:
            _clients.remove(q)
        except ValueError:
            pass


def broadcast(event, data):
    payload = json.dumps(data)
    dead = []
    with _lock:
        for q in _clients:
            try:
                q.put_nowait((event, payload))
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                _clients.remove(q)
            except ValueError:
                pass


def get_client_count():
    return len(_clients)


def sse_stream(q):
    """Generator for Flask SSE response."""
    yield ":\n\n"  # Initial comment to establish connection
    try:
        while True:
            try:
                event, data = q.get(timeout=30)
                yield f"event: {event}\ndata: {data}\n\n"
            except Empty:
                # Keepalive
                yield ":\n\n"
    except GeneratorExit:
        remove_client(q)
