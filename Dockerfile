FROM python:3.11-slim

WORKDIR /app

# Install deps without relying on a separate COPY of requirements.txt
# (some Bothost builds start with a sparse context).
RUN pip install --no-cache-dir \
    aiogram==3.22.0 \
    pydantic-settings==2.10.1 \
    python-dotenv==1.1.1

COPY . .

# Fail loudly with directory listing if project files are missing
RUN test -f main.py && test -d bot && test -d webapp \
    || (echo "Build context missing project files:" && ls -la && exit 1)

CMD ["python", "main.py"]
