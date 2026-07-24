from __future__ import annotations

from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str
    admin_chat_id: int
    manager_username: str = "knyaztut"
    manager_phone: str = "+375297330592"
    shop_address: str = "Минск, Нововиленская 10"
    shop_name: str = "КнязьMobile"

    webapp_host: str = "0.0.0.0"
    webapp_port: int = 8765
    # Bothost injects PORT / DOMAIN when web UI is enabled
    port: int | None = Field(default=None, validation_alias="PORT")
    domain: str | None = Field(default=None, validation_alias="DOMAIN")
    webapp_url: str = ""
    allow_insecure_orders: bool = False

    @cached_property
    def listen_port(self) -> int:
        return self.port or self.webapp_port

    @cached_property
    def public_webapp_url(self) -> str:
        if self.webapp_url.strip():
            return self.webapp_url.strip().rstrip("/")
        if self.domain:
            domain = self.domain.strip()
            if domain.startswith("http://") or domain.startswith("https://"):
                return domain.rstrip("/")
            return f"https://{domain}".rstrip("/")
        return f"http://127.0.0.1:{self.listen_port}"


settings = Settings()
