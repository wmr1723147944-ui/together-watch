"""Curated metadata and search navigation only; never fetch or resolve media."""

import re
import unicodedata
from urllib.parse import quote, urlencode, urlparse
from site_directory import DIRECTORY, site_entries


REVIEW_DATE = "2026-10-14"
SEARCH_PROVIDERS = (
    {"id": "bilibili", "name": "哔哩哔哩", "base": "https://search.bilibili.com/all", "param": "keyword", "home": "https://www.bilibili.com/"},
    {"id": "tencent", "name": "腾讯视频", "base": "https://v.qq.com/x/search/", "param": "q", "home": "https://v.qq.com/"},
    {"id": "youku", "name": "优酷", "base": "https://so.youku.com/search_video/q_", "param": "", "home": "https://www.youku.com/"},
)

# Navigation metadata, not media endpoints. Public/free viewing does not grant
# this app redistribution rights, nor does it establish player compatibility.
SOURCE_TYPES = {"all": "全部类型", "movie": "电影", "series": "电视剧", "animation": "动漫"}
FREE_SOURCES = (
    {
        "id": "1905-free", "name": "1905 免费大片", "genres": ("movie", "series"),
        "url": "https://www.1905.com/special/pdsix/2024wlstzb/7008-fsmorevideo.html?posid=32638",
        "evidence_url": "https://www.1905.com/special/pdsix/2024wlstzb/7008-fsmorevideo.html?posid=32638",
        "description": "从官方“免费大片”栏目找电影，也有电视剧入口。",
        "access": "免费栏目；站内另有 VIP / 单片付费", "region": "片目与地区限制以原站为准",
        "quality_note": "未核验免费片目的最高画质，不标为 4K。",
    },
    {
        "id": "cctv-library", "name": "央视片库", "genres": ("series", "animation"),
        "url": "https://tv.cctv.com/yxg/index.shtml", "evidence_url": "https://tv.cctv.com/",
        "description": "在片库切换“电视剧”或“动画片”，寻找官方公开点播剧集。",
        "access": "公开点播；逐集以原站可观看状态为准", "region": "部分节目可能有地区或版权期限限制",
        "quality_note": "片库不等于全站 4K；老剧可能只有标清或高清。",
    },
    {
        "id": "acfun-bangumi", "name": "AcFun 番剧", "genres": ("animation",),
        "url": "https://m.acfun.cn/bangumilist", "evidence_url": "https://m.acfun.cn/bangumilist",
        "description": "从官方番剧目录找国创与日本动画；注意区分免费集和付费观看标签。",
        "access": "部分免费；目录同时包含付费番剧", "region": "部分内容会要求登录或使用原站 APP",
        "quality_note": "按具体番剧播放器选项确认；未承诺免费 4K。",
    },
    {
        "id": "mango-library", "name": "芒果 TV 片库", "genres": ("movie", "series", "animation"),
        "url": "https://www.mgtv.com/lib/2?channelId=2", "evidence_url": "https://www.mgtv.com/lib/2?channelId=2",
        "description": "进入后选择“免费”，再切换电视剧、电影或动漫分类。入口本身未预选免费。",
        "access": "需在原站筛选免费；会员内容不包含在内", "region": "按地区、账号和当前片目显示为准",
        "quality_note": "免费观看与高画质权限分开，不承诺免费 4K。",
    },
    {
        "id": "plex-free", "name": "Plex 免费影视", "genres": ("movie", "series", "animation"),
        "url": "https://www.plex.tv/watch-free/", "evidence_url": "https://support.plex.tv/articles/frequently-asked-questions-vod/",
        "description": "广告支持的官方免费电影和剧集；不要把租赁片目或聚合搜索结果当作免费正片。",
        "access": "免费点播含广告；不需 Plex Pass", "region": "海外平台；片目因地区而异，中文内容和字幕有限",
        "quality_note": "没有核实到免费片库统一提供 4K，不加 4K 标记。",
    },
    {
        "id": "tubi-free", "name": "Tubi 免费影视", "genres": ("movie", "series", "animation"),
        "url": "https://tubitv.com/", "evidence_url": "https://tubitv.com/help-center/About-Tubi/articles/4409969055259",
        "description": "广告支持的电影、剧集和动漫片库。仅供平台支持地区的用户使用。",
        "access": "免费含广告；不是全地区可用", "region": "中国大陆不在官方支持地区名单；不保证可用",
        "quality_note": "未核验当前片目分辨率，不把免费片库标成 4K。",
    },
    {
        "id": "blender-films", "name": "Blender 开放动画", "genres": ("movie", "animation"),
        "url": "https://studio.blender.org/films/", "evidence_url": "https://studio.blender.org/films/",
        "description": "创作者发布的开放动画短片；下方列有逐部作品和许可资料。",
        "access": "公开成片可看；制作素材和订阅服务另计", "region": "海外站点；实际连通性和播放兼容性待测",
        "quality_note": "部分作品有 4K 版本，不代表全部作品或当前播放都达到 4K。",
    },
    {
        "id": "cctv-4k", "name": "央视 4K 专区", "genres": ("series",),
        "url": "https://tv.cctv.com/4K/index.shtml", "evidence_url": "https://tv.cctv.com/4K/index.shtml",
        "description": "官方 4K 专区含电视剧，也有纪录片和其他节目。",
        "access": "公开专区；以具体播放页可用状态为准", "region": "实际播放可能受设备、网络和地区影响",
        "quality_note": "仅确认官方 4K 专区；未检测本机实际码流，不代表自动以 4K 播放。",
        "has_4k_evidence": True, "quality_evidence_url": "https://tv.cctv.com/4K/index.shtml",
    },
)

OPEN_FILMS = (
    {
        "id": "big-buck-bunny", "title": "Big Buck Bunny", "aliases": "大雄兔 大兔子 桃子计划 动画 短片",
        "description": "Blender 开放动画短片。完整影片须保留全部片尾。",
        "credit": "Blender Foundation", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "page_url": "https://peach.blender.org/", "evidence_url": "https://peach.blender.org/about/",
        "condition": "按许可可传播和商用；DVD 封面、标志等不一并授权。",
        "has_4k_evidence": True,
        "quality_evidence_url": "https://peach.blender.org/2013/12/high-frame-rate-4k-and-stereo-3d-release/",
        "quality_note": "官方发布过 4K / 高帧率版本；这是版本依据，不是当前播放画质检测。",
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
    {
        "id": "glass-half", "title": "Glass Half", "aliases": "半杯 半满玻璃杯 画廊 动画 短片 喜剧",
        "description": "两位业余艺术评论者在画廊争论的动画短片。",
        "credit": "Blender Foundation | studio.blender.org", "license": "CC BY 3.0",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "page_url": "https://video.blender.org/w/dnayqfMS4PAE9pSZ3kyVUb",
        "evidence_url": "https://studio.blender.org/projects/glass-half/pages/licensing/",
        "condition": "按许可署名并链接来源；商标、标志及非本项目素材不包含在许可中。",
        "has_4k_evidence": True, "quality_evidence_url": "https://studio.blender.org/films/",
        "quality_note": "官方电影目录明确介绍 4K 版本；当前播放版本和实际码流尚未核验。",
    },
    {
        "id": "wing-it", "title": "Wing It!", "aliases": "展翅 工程师 飞行员 太空 动画 短片 喜剧",
        "description": "一位工程师和一位飞行爱好者意外坐上失控飞船的动画喜剧。",
        "credit": "Blender Foundation | studio.blender.org", "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "page_url": "https://studio.blender.org/projects/wing-it/",
        "evidence_url": "https://studio.blender.org/projects/wing-it/pages/licensing/",
        "condition": "按许可署名、链接许可并说明改动；标志与商标不包含在许可中。",
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
    if parsed.hostname in {"huarw.com", "www.cupfox.in", "yhdmoe.com", "ddys.io"} and parsed.path.rstrip("/") == "/search":
        return True
    if parsed.hostname == "www.fcma.cc" and parsed.path in {"/search/index.html", "/public/auto/search1.html"}:
        return True
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


def discovery_context(query="", disabled_providers=(), disabled_films=(),
                      disabled_sources=(), source_type="all", quality="all"):
    query = normalize_query(query)
    source_type = source_type if source_type in SOURCE_TYPES else "all"
    quality = "4k" if quality == "4k" else "all"
    tokens = query.lower().split()
    films = []
    for film in OPEN_FILMS:
        if film["id"] in disabled_films:
            continue
        searchable = normalize_query(" ".join((film["title"], film["aliases"]))).lower()
        films.append({**film, "searchable": searchable, "matches":
                      all(token in searchable for token in tokens)
                      and (quality != "4k" or film.get("has_4k_evidence", False))})
    sources = []
    for source in FREE_SOURCES:
        if source["id"] in disabled_sources:
            continue
        sources.append({**source, "genre_label": " / ".join(SOURCE_TYPES[g] for g in source["genres"]),
                        "matches": (source_type == "all" or source_type in source["genres"])
                        and (quality != "4k" or source.get("has_4k_evidence", False))})
    return {
        "discovery_sites": site_entries(disabled_sources),
        "discovery_sites_reviewed": DIRECTORY["reviewed"],
        "discovery_sites_reference": DIRECTORY["reference"],
        "discovery_sites_excluded": DIRECTORY["excluded"],
        "discovery_query": query,
        "discovery_review_date": REVIEW_DATE,
        "discovery_films": films,
        "discovery_count": sum(film["matches"] for film in films),
        "discovery_sources": sources,
        "discovery_source_count": sum(source["matches"] for source in sources),
        "discovery_source_types": SOURCE_TYPES,
        "discovery_source_type": source_type,
        "discovery_quality": quality,
        "discovery_providers": [
            {**provider, "url": search_url(provider, query)}
            for provider in SEARCH_PROVIDERS if provider["id"] not in disabled_providers
        ],
    }
