"""Backward-compatible cloud entrypoint.

The application now has a single source of truth in app.py.
"""

import os

from app import app, socketio


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        allow_unsafe_werkzeug=True,
    )
