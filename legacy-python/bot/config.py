from __future__ import annotations

import os
from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str
    # Default keeps Bothost from crashing if ENV was forgotten
    admin_chat_id: int = 318629821
    manager_username: str = "knyaztut"
    manager_phone: str = "+375297330592"
    shop_address: str = "Минск, Нововиленская 10"
    shop_name: str = "КнязьMobile"

    webapp_host: str = "0.0.0.0"
    # Bothost default panel port for new bots
    webapp_port: int = 3000
    webapp_url: str = ""
    allow_insecure_orders: bool = False

    @cached_property
    def listen_port(self) -> int:
        # Read PORT directly: Bothost proxy routes to this port
        raw = os.getenv("PORT") or os.getenv("WEBAPP_PORT")
        if raw:
            try:
                return int(raw)
            except ValueError:
                pass
        return self.webapp_port

    @cached_property
    def public_webapp_url(self) -> str:
        # Prefer Bothost DOMAIN so stale local tunnels in WEBAPP_URL don't break Mini App
        domain = (os.getenv("DOMAIN") or "").strip()
        if domain:
            if domain.startswith("http://") or domain.startswith("https://"):
                return domain.rstrip("/")
            return f"https://{domain}".rstrip("/")
        if self.webapp_url.strip():
            return self.webapp_url.strip().rstrip("/")
        return f"http://127.0.0.1:{self.listen_port}"


settings = Settings()
