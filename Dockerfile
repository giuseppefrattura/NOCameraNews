FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Expose backend port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "server.js"]
