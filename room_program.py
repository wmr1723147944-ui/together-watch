"""Share public episode identities, never arbitrary URLs or media credentials."""
import re
from urllib.parse import quote
from catalog_sources import PUBLIC_ID

from source_search import selection_page, selection_path

SAMPLES = {
    "sintel": "https://media.w3.org/2010/05/sintel/trailer.mp4",
    "bunny": "https://media.w3.org/2010/05/bunny/trailer.mp4",
}


def normalize_program(value, enabled_sources):
    if not isinstance(value, dict) or set(value) != {"source", "item", "episode"}:
        return None
    source, item, episode = (value[k] for k in ("source", "item", "episode"))
    if not all(isinstance(v, str) for v in (source, item, episode)):
        return None
    if source == "sample" and item in SAMPLES and episode == "video":
        return {**value, "page": SAMPLES[item], "exact_episode": True}
    if source == "kanju" and re.fullmatch(PUBLIC_ID, item) and episode == "page":
        # A public player permalink, NOT an extracted stream / signed API URL.
        return {**value, "page": "https://www.kanju.ai/player/" + quote(item, safe='-_'), "exact_episode": False}
    if source not in enabled_sources or not selection_path(source, item, episode):
        return None
    return {**value, "page": selection_page(source, item, episode),
            "exact_episode": source != "ddys"}
