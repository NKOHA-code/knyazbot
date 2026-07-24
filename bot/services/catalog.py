from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path


DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.json"


@dataclass(frozen=True)
class Category:
    id: str
    title: str
    emoji: str


@dataclass(frozen=True)
class ColorOption:
    id: str
    name: str
    hex: str
    image: str | None = None


@dataclass(frozen=True)
class ConfigOption:
    id: str
    storage: str
    price: int
    in_stock: bool

    def price_text(self) -> str:
        if self.price <= 0:
            return "уточнит менеджер"
        return f"{self.price} BYN"


@dataclass(frozen=True)
class Product:
    id: str
    category: str
    name: str
    badge: str | None
    gift: str | None
    note: str
    image: str | None
    colors: tuple[ColorOption, ...]
    configs: tuple[ConfigOption, ...]

    def min_price(self) -> int | None:
        priced = [c.price for c in self.configs if c.price > 0]
        return min(priced) if priced else None

    def price_from_text(self) -> str:
        value = self.min_price()
        if value is None:
            return "цену уточнит менеджер"
        return f"от {value} BYN"

    def get_color(self, color_id: str) -> ColorOption | None:
        for color in self.colors:
            if color.id == color_id:
                return color
        return None

    def get_config(self, config_id: str) -> ConfigOption | None:
        for config in self.configs:
            if config.id == config_id:
                return config
        return None

    def image_for_color(self, color_id: str | None = None) -> str | None:
        if color_id:
            color = self.get_color(color_id)
            if color and color.image:
                return color.image
        return self.image

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "name": self.name,
            "badge": self.badge,
            "gift": self.gift,
            "note": self.note,
            "image": self.image,
            "price_from": self.price_from_text(),
            "min_price": self.min_price(),
            "colors": [asdict(c) for c in self.colors],
            "configs": [asdict(c) for c in self.configs],
        }


@lru_cache(maxsize=1)
def _raw() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def reload_catalog() -> None:
    _raw.cache_clear()


def get_categories() -> list[Category]:
    return [Category(**c) for c in _raw()["categories"]]


def get_category(category_id: str) -> Category | None:
    for category in get_categories():
        if category.id == category_id:
            return category
    return None


def get_products(category_id: str | None = None) -> list[Product]:
    products: list[Product] = []
    for item in _raw()["products"]:
        product = Product(
            id=item["id"],
            category=item["category"],
            name=item["name"],
            badge=item.get("badge"),
            gift=item.get("gift"),
            note=item.get("note", ""),
            image=item.get("image"),
            colors=tuple(
                ColorOption(
                    id=c["id"],
                    name=c["name"],
                    hex=c["hex"],
                    image=c.get("image"),
                )
                for c in item["colors"]
            ),
            configs=tuple(ConfigOption(**c) for c in item["configs"]),
        )
        if category_id is None or product.category == category_id:
            products.append(product)
    return products


def get_product(product_id: str) -> Product | None:
    for product in get_products():
        if product.id == product_id:
            return product
    return None


def catalog_payload() -> dict:
    return {
        "categories": [asdict(c) for c in get_categories()],
        "products": [p.to_dict() for p in get_products()],
        "payments": [
            {"id": "cash", "title": "Наличные / карта"},
            {"id": "installment", "title": "Рассрочка"},
            {"id": "leasing", "title": "Лизинг"},
        ],
    }
