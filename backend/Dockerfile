FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 8000

# Use shell form so $PORT gets expanded at runtime
# Railway sets PORT dynamically; default to 8000 for local dev
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
