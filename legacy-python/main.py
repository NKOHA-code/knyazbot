"""Bothost entrypoint. Also works locally: python main.py"""

from bot.__main__ import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())
