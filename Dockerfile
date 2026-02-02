FROM node:20-slim

# Install dependencies for opencode-ai and health checks
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install opencode-ai CLI globally
RUN npm install -g opencode-ai

# Create app directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy project files
COPY . .

# Make entrypoint executable (just in case)
RUN chmod +x docker-entrypoint.sh

# Expose the bridge port
EXPOSE 8083
# Expose the opencode server port (internal use mostly)
EXPOSE 4096

# Set environment variables
ENV NODE_ENV=production
ENV OPENCODE_BASE_URL=http://127.0.0.1:4096
ENV OPENCODE_KEY=kimera

# Use the docker-entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]
