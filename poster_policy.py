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
