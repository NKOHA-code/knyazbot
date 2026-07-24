"""Generate stylized product preview images for the Mini App catalog."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[2] / "webapp" / "images"
SIZE = (900, 1100)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))  # type: ignore[return-value]


def bg_gradient(draw: ImageDraw.ImageDraw, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> None:
    for y in range(SIZE[1]):
        t = y / (SIZE[1] - 1)
        color = mix(top, bottom, t)
        draw.line([(0, y), (SIZE[0], y)], fill=color)


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int] | None = None,
    outline: tuple[int, int, int] | None = None,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_phone(img: Image.Image, body: tuple[int, int, int], accent: tuple[int, int, int]) -> None:
    layer = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = 250, 140, 650, 920
    shadow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    rounded_rect(sdraw, (x0 + 18, y0 + 28, x1 + 18, y1 + 28), 58, fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    img.alpha_composite(shadow)

    frame = mix(body, (255, 255, 255), 0.08)
    rounded_rect(draw, (x0, y0, x1, y1), 58, fill=frame)
    rounded_rect(draw, (x0 + 16, y0 + 16, x1 - 16, y1 - 16), 46, fill=(18, 18, 20, 255))
    # screen glow
    screen = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    sd = ImageDraw.Draw(screen)
    rounded_rect(sd, (x0 + 28, y0 + 70, x1 - 28, y1 - 70), 28, fill=(*accent, 55))
    screen = screen.filter(ImageFilter.GaussianBlur(2))
    layer.alpha_composite(screen)
    # dynamic island / camera
    rounded_rect(draw, (390, 188, 510, 228), 18, fill=(10, 10, 12, 255))
    draw.ellipse((470, 198, 498, 226), fill=mix(accent, (40, 40, 50), 0.4))
    img.alpha_composite(layer)


def draw_laptop(img: Image.Image, body: tuple[int, int, int], accent: tuple[int, int, int]) -> None:
    layer = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    shadow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse((170, 820, 760, 930), fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    img.alpha_composite(shadow)

    # lid
    rounded_rect(draw, (180, 220, 720, 690), 28, fill=mix(body, (255, 255, 255), 0.12))
    rounded_rect(draw, (205, 245, 695, 655), 18, fill=(20, 22, 28, 255))
    glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    rounded_rect(gd, (220, 260, 680, 640), 12, fill=(*accent, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(1))
    layer.alpha_composite(glow)
    # base
    draw.polygon([(210, 700), (690, 700), (760, 820), (140, 820)], fill=mix(body, (0, 0, 0), 0.15))
    draw.rounded_rectangle((360, 740, 540, 760), radius=8, fill=(60, 60, 65, 255))
    img.alpha_composite(layer)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in (
        r"C:\Windows\Fonts\georgia.ttf",
        r"C:\Windows\Fonts\seguiui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ):
        path = Path(name)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def make_image(product_id: str, title: str, color_hex: str, kind: str = "phone") -> Path:
    accent = hex_to_rgb(color_hex)
    top = mix((18, 16, 14), accent, 0.22)
    bottom = mix((10, 9, 8), accent, 0.08)
    img = Image.new("RGBA", SIZE, (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)
    bg_gradient(draw, top, bottom)

    # soft orb
    orb = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(orb)
    od.ellipse((120, 80, 780, 740), fill=(*accent, 40))
    orb = orb.filter(ImageFilter.GaussianBlur(60))
    img.alpha_composite(orb)

    if kind == "laptop":
        draw_laptop(img, accent, accent)
    else:
        draw_phone(img, accent, accent)

    title_font = font(54)
    sub_font = font(28)
    draw.text((60, 980), title, font=title_font, fill=(244, 239, 230, 255))
    draw.text((60, 1045), "КнязьMobile", font=sub_font, fill=(212, 179, 106, 230))

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{product_id}.png"
    img.convert("RGB").save(path, "PNG", optimize=True)
    return path


PRODUCTS = [
    ("iphone-17", "iPhone 17", "#7fa8c9", "phone"),
    ("iphone-17e", "iPhone 17e", "#f2c4cf", "phone"),
    ("iphone-17-pro", "iPhone 17 Pro", "#d35400", "phone"),
    ("iphone-17-promax", "iPhone 17 Pro Max", "#1f3a5f", "phone"),
    ("iphone-16", "iPhone 16", "#3b5bdb", "phone"),
    ("s25-ultra", "Galaxy S25 Ultra", "#8a8d91", "phone"),
    ("s25-plus", "Galaxy S25+", "#9fc9b4", "phone"),
    ("s25", "Galaxy S25", "#1e2a44", "phone"),
    ("s25-fe", "Galaxy S25 FE", "#6f93c4", "phone"),
    ("pixel-10", "Pixel 10", "#3f4c8c", "phone"),
    ("pixel-10-pro", "Pixel 10 Pro", "#5f7f6a", "phone"),
    ("pixel-10-pro-xl", "Pixel 10 Pro XL", "#9aa3ad", "phone"),
    ("macbook-neo", "MacBook Neo", "#2c3e6b", "laptop"),
]


if __name__ == "__main__":
    for product_id, title, color, kind in PRODUCTS:
        path = make_image(product_id, title, color, kind)
        print(path.name)
