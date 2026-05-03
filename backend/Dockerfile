FROM python:3.12-slim

ENV UV_PROJECT_ENVIRONMENT=/opt/voice-s2s-venv \
    UV_LINK_MODE=copy \
    PATH="/opt/voice-s2s-venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates g++ git make scons \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app/backend
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --extra dev --extra qwen --extra tts
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
