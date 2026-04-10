FROM node:20-alpine

# Build tools needed for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install backend dependencies (with native build)
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

# Copy all source files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create data directory
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/data/meisner.db
ENV PORT=3000

CMD ["node", "backend/server.js"]
