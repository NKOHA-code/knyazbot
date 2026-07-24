FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    aiogram==3.22.0 \
    pydantic-settings==2.10.1 \
    python-dotenv==1.1.1 \
    aiohttp==3.12.15

COPY . .

RUN test -f main.py && test -d bot && test -d webapp \
    || (echo "Build context missing project files:" && ls -la && exit 1)

# Must match Bothost panel Port (locked to 8765 for this bot)
ENV PORT=8765
EXPOSE 8765

CMD ["python", "main.py"]
