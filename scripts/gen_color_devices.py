"""Per-color catalog art: colored DEVICE BODY (back view), neutral dark background."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATHS = [
    ROOT / "catalog" / "catalog.json",
    ROOT / "public" / "catalog.json",
    ROOT / "data" / "catalog.json",
]
OUT_DIR = ROOT / "public" / "images" / "colors"
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 900, 1125
BG_TOP = (28, 26, 24)
BG_BOT = (12, 11, 10)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))  # type: ignore[return-value]


def lum(rgb: tuple[int, int, int]) -> float:
    r, g, b = [c / 255 for c in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def font(size: int) -> ImageFont.ImageFont:
    for name in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_bg() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_BOT)
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=mix(BG_TOP, BG_BOT, y / (H - 1)))
    # Neutral soft spotlight — NOT product color
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((160, 120, W - 160, 780), fill=(255, 255, 255, 16))
    return Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(70)))


def draw_phone_back(
    base: Image.Image,
    color: tuple[int, int, int],
    *,
    brand: str,
    pro: bool = False,
    tall: bool = False,
) -> None:
    """Back of the phone — entire chassis is the selected color."""
    L = lum(color)
    body = color
    edge = mix(color, (255, 255, 255), 0.18 if L < 0.55 else 0.08)
    edge = mix(edge, (160, 160, 165), 0.15)
    lens_ring = mix(color, (30, 30, 32), 0.55)
    lens_glass = (25, 28, 35)
    logo = mix(color, (255, 255, 255) if L < 0.45 else (0, 0, 0), 0.35)

    phone_w = 400 if tall else 372
    phone_h = 830 if tall else 760
    left = (W - phone_w) // 2
    top = 85 if tall else 115
    radius = 68

    # Drop shadow (neutral black)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (left + 18, top + 30, left + phone_w + 18, top + phone_h + 30),
        radius=radius,
        fill=(0, 0, 0, 130),
    )
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28)))

    d = ImageDraw.Draw(base)
    # Metal edge
    d.rounded_rectangle(
        (left - 6, top - 6, left + phone_w + 6, top + phone_h + 6),
        radius=radius + 5,
        fill=edge,
    )
    # BODY — full color of selected finish
    d.rounded_rectangle((left, top, left + phone_w, top + phone_h), radius=radius, fill=body)

    # Soft specular highlight on body (same hue family)
    hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse(
        (left + 40, top + 60, left + phone_w - 100, top + phone_h - 200),
        fill=(255, 255, 255, 32 if L < 0.5 else 48),
    )
    base.alpha_composite(hi.filter(ImageFilter.GaussianBlur(36)))

    d = ImageDraw.Draw(base)

    # Camera module
    if brand == "pixel":
        # horizontal bar
        bar_h = 78
        by = top + 70
        d.rounded_rectangle((left + 28, by, left + phone_w - 28, by + bar_h), radius=28, fill=mix(body, (0, 0, 0), 0.2))
        for i, ox in enumerate((70, 160, 250)):
            cx = left + ox
            cy = by + 18
            d.ellipse((cx, cy, cx + 42, cy + 42), fill=lens_ring)
            d.ellipse((cx + 8, cy + 8, cx + 34, cy + 34), fill=lens_glass)
        d.ellipse((left + phone_w - 100, by + 28, left + phone_w - 72, by + 56), fill=(240, 240, 230))
    elif pro or brand == "samsung":
        # square island / floating cams
        mx, my = left + 42, top + 52
        mw = 150 if pro else 130
        mh = 150 if pro else 130
        d.rounded_rectangle((mx, my, mx + mw, my + mh), radius=36, fill=mix(body, (0, 0, 0), 0.16))
        positions = [(22, 22), (78, 22), (22, 78)] if not (brand == "samsung" and not pro) else [(28, 24), (28, 72)]
        if brand == "samsung" and pro:
            positions = [(26, 22), (26, 68), (26, 114), (78, 22), (78, 68)]
            mw, mh = 140, 170
            d.rounded_rectangle((mx, my, mx + mw, my + mh), radius=34, fill=mix(body, (0, 0, 0), 0.16))
        for ox, oy in positions:
            d.ellipse((mx + ox, my + oy, mx + ox + 36, my + oy + 36), fill=lens_ring)
            d.ellipse((mx + ox + 7, my + oy + 7, mx + ox + 29, my + oy + 29), fill=lens_glass)
    else:
        # vertical dual camera (iPhone standard)
        mx, my = left + 44, top + 52
        d.rounded_rectangle((mx, my, mx + 92, my + 168), radius=28, fill=mix(body, (0, 0, 0), 0.14))
        for oy in (18, 90):
            d.ellipse((mx + 22, my + oy, mx + 70, my + oy + 48), fill=lens_ring)
            d.ellipse((mx + 30, my + oy + 8, mx + 62, my + oy + 40), fill=lens_glass)

    # Brand mark
    cx, cy = left + phone_w // 2, top + int(phone_h * 0.58)
    if brand == "apple":
        # simple apple-like circle mark
        d.ellipse((cx - 28, cy - 34, cx + 28, cy + 28), fill=logo)
        d.ellipse((cx - 10, cy - 48, cx + 18, cy - 18), fill=body)  # bite/leaf negative space
    elif brand == "samsung":
        d.text((cx - 36, cy - 14), "SAMSUNG", fill=logo, font=font(18))
    elif brand == "pixel":
        d.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), outline=logo, width=5)
        d.text((cx - 8, cy - 12), "G", fill=logo, font=font(22))

    # Side buttons (same body color family)
    btn = mix(edge, (0, 0, 0), 0.15)
    d.rounded_rectangle((left + phone_w - 2, top + 200, left + phone_w + 9, top + 280), radius=3, fill=btn)
    d.rounded_rectangle((left - 9, top + 220, left + 2, top + 320), radius=3, fill=btn)
    d.rounded_rectangle((left - 9, top + 340, left + 2, top + 400), radius=3, fill=btn)


def draw_laptop(base: Image.Image, color: tuple[int, int, int]) -> None:
    L = lum(color)
    body = color
    edge = mix(color, (230, 230, 235), 0.18 if L < 0.55 else 0.1)
    lid_inner = mix(color, (0, 0, 0), 0.08)

    lid_w, lid_h = 620, 400
    left = (W - lid_w) // 2
    top = 150

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((left + 24, top + 40, left + lid_w + 24, top + lid_h + 170), radius=22, fill=(0, 0, 0, 120))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))

    d = ImageDraw.Draw(base)
    # Closed-ish lid from above/front — BODY COLOR
    d.rounded_rectangle((left, top, left + lid_w, top + lid_h), radius=20, fill=edge)
    d.rounded_rectangle((left + 10, top + 10, left + lid_w - 10, top + lid_h - 10), radius=14, fill=body)
    # Apple mark
    d.ellipse((left + lid_w // 2 - 26, top + lid_h // 2 - 30, left + lid_w // 2 + 26, top + lid_h // 2 + 22), fill=mix(body, (0, 0, 0), 0.25))

    # Open base
    bt = top + lid_h - 6
    d.rounded_rectangle((left - 12, bt, left + lid_w + 12, bt + 155), radius=16, fill=edge)
    d.rounded_rectangle((left - 2, bt + 8, left + lid_w + 2, bt + 145), radius=12, fill=lid_inner)
    key = mix(lid_inner, (0, 0, 0), 0.22)
    for row in range(4):
        for col in range(12):
            x = left + 36 + col * 46
            y = bt + 26 + row * 22
            d.rounded_rectangle((x, y, x + 36, y + 14), radius=3, fill=key)
    tw = 170
    d.rounded_rectangle((left + (lid_w - tw) // 2, bt + 112, left + (lid_w + tw) // 2, bt + 136), radius=6, fill=mix(lid_inner, (255, 255, 255), 0.06))


def brand_of(product_id: str) -> str:
    if product_id.startswith("iphone") or product_id.startswith("mac"):
        return "apple"
    if product_id.startswith("s25") or product_id.startswith("galaxy"):
        return "samsung"
    if product_id.startswith("pixel"):
        return "pixel"
    return "apple"


def render(product_id: str, product_name: str, color_name: str, hex_color: str) -> Image.Image:
    color = hex_rgb(hex_color)
    canvas = make_bg()
    if product_id.startswith("mac"):
        draw_laptop(canvas, color)
    else:
        draw_phone_back(
            canvas,
            color,
            brand=brand_of(product_id),
            pro="pro" in product_id or "ultra" in product_id,
            tall="promax" in product_id or "ultra" in product_id or "pro-xl" in product_id,
        )
    out = canvas.convert("RGB")
    d = ImageDraw.Draw(out)
    d.text((44, H - 132), product_name, fill=(244, 241, 235), font=font(38))
    d.text((44, H - 82), color_name, fill=(175, 170, 160), font=font(28))
    d.ellipse((W - 100, 44, W - 40, 104), fill=color, outline=(255, 255, 255), width=4)
    return out


def main() -> None:
    data = json.loads(CATALOG_PATHS[0].read_text(encoding="utf-8-sig"))
    n = 0
    for product in data["products"]:
        for color in product.get("colors") or []:
            out_name = f"{product['id']}-{color['id']}.png"
            img = render(product["id"], product["name"], color["name"], color["hex"])
            img.save(OUT_DIR / out_name, "PNG", optimize=True)
            color["image"] = f"/images/colors/{out_name}"
            n += 1
            print("OK", out_name)
        first = (product.get("colors") or [None])[0]
        if first and first.get("image"):
            product["image"] = first["image"]

    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    for p in CATALOG_PATHS:
        p.write_bytes(text.encode("utf-8"))
    print("generated", n)


if __name__ == "__main__":
    main()
