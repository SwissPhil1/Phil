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

# Use Python launcher for proper error logging on Railway
CMD ["python", "run.py"]
