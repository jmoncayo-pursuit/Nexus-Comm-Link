# FROM node:20-slim
FROM node:20-slim

# Install dependencies for puppeteer/chrome if needed (though we use CDP, node-canvas or other libs might need it)
# For now, keeping it minimal as we are a bridge server
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including dev (though we mostly need production)
RUN npm install

# Copy application code
COPY . .

# Ensure certs directory exists
RUN mkdir -p certs

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Use a production-ready start script or just node server.js
CMD ["node", "server.js"]
