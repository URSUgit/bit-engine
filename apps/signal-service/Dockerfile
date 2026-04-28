FROM python:3.11-slim

WORKDIR /app

# Install system deps for torch + transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir fastapi uvicorn pydantic httpx python-dotenv

COPY . .

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
