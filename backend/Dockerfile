FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Create data directory and make startup script executable
RUN mkdir -p /app/data && chmod +x /app/start.sh

EXPOSE 8000

CMD ["/app/start.sh"]
