FROM python:3.11-slim

WORKDIR /app

# Custom image: Bothost auto-build breaks on aiogram3
# because it checks for aiogram.utils.executor (aiogram 2 only).
RUN pip install --no-cache-dir \
    aiogram==3.22.0 \
    pydantic-settings==2.10.1 \
    python-dotenv==1.1.1 \
    aiohttp==3.12.15

COPY . .

RUN test -f main.py && test -d bot && test -d webapp \
    || (echo "Build context missing project files:" && ls -la && exit 1)

# Match Bothost default panel port for new apps
ENV PORT=3000
EXPOSE 3000

CMD ["python", "main.py"]
