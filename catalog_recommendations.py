"""Editorial title suggestions, not a live ranking or a playback guarantee.

Only public catalogue metadata is embedded here. Clicking a title performs the
normal bounded search; no provider, room or media URL is selected in advance.
"""

RECOMMENDATIONS = (
    ("星际穿越", "2014", "电影", "movie", "穿过星海，回到你身边", "interstellar"),
    ("开端", "2022", "剧集", "series", "如果这一天，可以重新开始", "reset"),
    ("Sintel", "2010", "动画短片", "animation", "一场关于寻找与告别的冒险", None),
    ("神奇阿呦之最强流星人", "2016", "动漫", "animation", "和小伙伴一起，去宇宙冒险", "shen-qi-a-you-zhi-zui-qiang-liu-xing-ren"),
    ("绿色星球", "2022", "纪录片", "documentary", "看看植物的另一面", "the-green-planet"),
    ("七个世界，一个星球", "2019", "纪录片", "documentary", "跨越七大洲的自然之旅", "seven-worlds-one-planet"),
    ("完美星球", "2021", "纪录片", "documentary", "风、阳光和生命的故事", "a-perfect-planet"),
    ("史前星球 第一季", "2022", "纪录片", "documentary", "把时间拨回恐龙的时代", "prehistoric-planet-season-1"),
)


def recommendations():
    return [dict(title=title, year=year, genre=genre, category=category, tagline=tagline,
                 poster=f"https://img.ddys.io/movies/{slug}.webp" if slug else
                 "https://video.blender.org/lazy-static/thumbnails/0eb052d0-fd51-43e6-aa33-ecdbf77a5d40.jpg")
            for title, year, genre, category, tagline, slug in RECOMMENDATIONS]
