"""Local integration fixture only; never used by the production entry point."""
import os
import app as application

application.danmaku_service.configured = lambda: True
application.danmaku_service.search = lambda q: [{"id":"123", "title":"集成测试影片", "episode":"第1集"}]
application.danmaku_service.comments = lambda episode: [{"id":"fixture-1", "time":85, "text":"公共弹幕测试", "kind":"public"}]
application.socketio.run(application.app, host='127.0.0.1', port=int(os.environ['PORT']), allow_unsafe_werkzeug=True)
