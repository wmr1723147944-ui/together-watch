"""Public cover metadata only. No image proxy or playback permission changes."""
import re
from urllib.parse import parse_qsl, urljoin, urlsplit

# Keep aligned with catalog-adapters.js; a parity test prevents CSP drift.
POSTER_DOMAINS = (
    'img.ddys.io', 'video.blender.org', 'huarw.com', 'cupfox.in',
    'yhdmoe.com', 'fcma.cc', '233dm.com', 'pkavi.com', 'kanju.ai',
    'doubanio.com', 'image.tmdb.org',
    # Observed on public Huarw / FCMA cards; images only, not playback hosts.
    'www.lufys.com', 'img.ffzy888.com', 'www.mdzypic.com', 'img.lzipic.com',
    'snzypic.vip', 'p.bfvp26.com', 'img.picbf.com', 'pps.vodfeiss.com', 'img.liangzipic.com',
    # Public PKAVI card covers (not the video host).
    'i1.vvmp4.com',
    # Observed on 233dm's public lazy-background film anchors.
    'as.cfhls.top',
    # Observed Huarw search card image hosts, 2026-10-27 (images only).
    'www.moduzytuuu.com', 'dbzy3.com', 'dbzy5.com', 'pic3.yzzyimg.online',
    'pic.youkupic.com', 'pic3.yzzyimages.com',
)
# Kanju's public cards use this exact image wrapper. Do not allow arbitrary
# proxy targets (localhost, signed media, or user-supplied URLs).
POSTER_WRAPPER_HOST = 'gimg0.baidu.com'
POSTER_WRAPPER_PATH = (r'/gimg/app=2001&n=0&g=0n&fmt=webp&src='
                      r'img\.baipiaozhe\.com/assets/images/[a-f0-9]{2}/[a-f0-9]{64}\.webp')
POSTER_QUERY_KEYS = {'w', 'h', 'width', 'height', 'q', 'quality', 'format', 'fit', 'auto', 'size', 'v'}


def poster_url(value, base):
    if not isinstance(value, str) or not value or len(value) > 2048 or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        return None
    try:
        url = urlsplit(urljoin(base, value))
        host = url.hostname or ''
        if (url.scheme != 'https' or url.username or url.password or url.port not in (None, 443)
                or url.fragment):
            return None
        if host == POSTER_WRAPPER_HOST:
            return url.geturl() if not url.query and re.fullmatch(POSTER_WRAPPER_PATH, url.path) else None
        if (not any(host == d or host.endswith('.' + d) for d in POSTER_DOMAINS)
                or not re.search(r'\.(?:jpe?g|png|webp|avif|gif)$', url.path, re.I)
                or re.search(r'(?:placeholder|loading|favicon|spacer)', url.path, re.I)
                or any(k not in POSTER_QUERY_KEYS for k, _ in parse_qsl(url.query, keep_blank_values=True))):
            return None
        return url.geturl()
    except ValueError:
        return None


def image_csp_sources():
    return ' '.join(f'https://{d} https://*.{d}' for d in POSTER_DOMAINS) + f' https://{POSTER_WRAPPER_HOST}'


def poster_candidates(values, base):
    return list(dict.fromkeys(url for value in values[:48] if (url := poster_url(value, base))))[:6]


def poster_attribute_candidates(attrs, base):
    """Select declared responsive covers near 640px/2x; retain safe fallbacks."""
    responsive = []
    for attr in ('data-srcset', 'data-lazy-srcset', 'srcset'):
        for part in (attrs.get(attr) or '').split(',')[:24]:
            m = re.fullmatch(r'\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*', part)
            if m and poster_url(m[1], base):
                size = float(m[2]) * (320 if m[3] == 'x' else 1)
                if 0 < size <= 20000:
                    responsive.append((size, m[1]))
    responsive.sort(key=lambda v: (0, v[0]) if v[0] >= 640 else (1, -v[0]))
    values = [v[1] for v in responsive]
    values.extend(attrs.get(k) for k in ('data-original', 'data-src', 'data-lazy-src', 'data-background', 'src'))
    match = re.search(r'''(?:background-image|background)\s*:\s*url\(\s*['"]?([^'"\s)]+)['"]?\s*\)''', attrs.get('style') or '', re.I)
    if match:
        values.append(match[1])
    return poster_candidates(values, base)


def poster_attributes(attrs, base):
    return next(iter(poster_attribute_candidates(attrs, base)), None)
