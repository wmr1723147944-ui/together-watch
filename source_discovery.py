"""Curated metadata and search navigation only; never fetch or resolve media."""

import re
import unicodedata
from urllib.parse import quote, urlencode, urlparse


REVIEW_DATE = "2026-10-14"
SEARCH_PROVIDERS = (
    {"id": "bilibili", "name": "哔哩哔哩", "base": "https://search.bilibili.com/all", "param": "keyword", "home": "https://www.bilibili.com/"},
    {"id": "tencent", "name": "腾讯视频", "base": "https://v.qq.com/x/search/", "param": "q", "home": "https://v.qq.com/"},
    {"id": "youku", "name": "优酷", "base": "https://so.youku.com/search_video/q_", "param": "", "home": "https://www.youku.com/"},
)
OPEN_FILMS = (
    {
        "id": "big-buck-bunny", "title": "Big Buck Bunny", "aliases": "大雄兔 大兔子 桃子计划 动画 短片",
        "description": "Blender 开放动画短片。完整影片须保留全部片尾。",
        "credit": "Blender Foundation", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "page_url": "https://peach.blender.org/", "evidence_url": "https://peach.blender.org/about/",
        "condition": "按许可可传播和商用；DVD 封面、标志等不一并授权。",
    },
    {
        "id": "spring", "title": "Spring", "aliases": "春 春天 牧羊女孩 动画 短片 无对白",
        "description": "牧羊女孩和小狗的故事；官方介绍为无对白短片。",
        "credit": "Blender Foundation", "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "page_url": "https://studio.blender.org/projects/spring/pages/about/",
        "evidence_url": "https://studio.blender.org/projects/spring/pages/about/",
        "condition": "按许可可传播和商用；按要求署名、链接许可并说明改动。",
    },
    {
        "id": "sintel", "title": "Sintel", "aliases": "辛特尔 辛特兒 寻龙记 奇幻 动画 短片",
        "description": "Blender 开放电影 Durian 项目的动画短片。",
        "credit": "Blender Foundation", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "page_url": "https://durian.blender.org/", "evidence_url": "https://durian.blender.org/sharing/",
        "condition": "按许可可传播和商用；须保留全部片尾，字幕与独立音乐另核。",
    },
    {
        "id": "tears-of-steel", "title": "Tears of Steel", "aliases": "钢铁之泪 钢铁泪 真人 科幻 短片",
        "description": "Blender Institute 制作的真人科幻特效短片。",
        "credit": "Blender Foundation / Blender Institute", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "page_url": "https://mango.blender.org/about/", "evidence_url": "https://mango.blender.org/about/",
        "condition": "按许可可传播和商用；保留片尾、署名及许可，字幕另核。",
    },
    {
        "id": "elephants-dream", "title": "Elephants Dream", "aliases": "大象之梦 大象梦 动画 短片",
        "description": "Blender 与 Netherlands Media Art Institute 的开放电影。",
        "credit": "Blender Foundation / Netherlands Media Art Institute", "license": "CC BY 2.5",
        "license_url": "https://creativecommons.org/licenses/by/2.5/",
        "page_url": "https://orange.blender.org/",
        "evidence_url": "https://orange.blender.org/blog/creative-commons-license-2/",
        "condition": "完整影片按许可可传播和商用、须保留片尾；独立配乐专辑是 NC-ND，不同许可。",
    },
)


def normalize_query(value):
    value = unicodedata.normalize("NFKC", value or "")
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    return " ".join(value.split())[:80].strip()


def search_url(provider, query):
    query = normalize_query(query)
    if not query:
        return provider["home"]
    if provider["param"]:
        return provider["base"] + "?" + urlencode({provider["param"]: query})
    return provider["base"] + quote(query, safe="")


def is_search_page(target_url):
    parsed = urlparse(target_url)
    for provider in SEARCH_PROVIDERS:
        base = urlparse(provider["base"])
        if parsed.hostname != base.hostname:
            continue
        if provider["param"]:
            if parsed.path.rstrip("/") == base.path.rstrip("/"):
                return True
        elif parsed.path.startswith(base.path):
            return True
    return False


def discovery_context(query="", disabled_providers=(), disabled_films=()):
    query = normalize_query(query)
    tokens = query.lower().split()
    films = []
    for film in OPEN_FILMS:
        if film["id"] in disabled_films:
            continue
        searchable = normalize_query(" ".join((film["title"], film["aliases"]))).lower()
        films.append({**film, "searchable": searchable, "matches": all(token in searchable for token in tokens)})
    return {
        "discovery_query": query,
        "discovery_review_date": REVIEW_DATE,
        "discovery_films": films,
        "discovery_count": sum(film["matches"] for film in films),
        "discovery_providers": [
            {**provider, "url": search_url(provider, query)}
            for provider in SEARCH_PROVIDERS if provider["id"] not in disabled_providers
        ],
    }
