import os

from app import app, socketio


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Together Watch is running at http://localhost:{port}")
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=os.environ.get("FLASK_DEBUG") == "1",
        allow_unsafe_werkzeug=True,
    )
