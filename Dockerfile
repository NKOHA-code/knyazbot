FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bothost: listen 0.0.0.0:$PORT for Mini App / domain proxy
CMD ["python", "main.py"]
