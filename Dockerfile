# Production Dockerfile — Zamorin Cafe ERP (v1.1.0)
FROM node:24-alpine AS base

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production

# Copy backend source code
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=4000
ENV TZ=Asia/Kolkata

EXPOSE 4000 3000

CMD ["node", "backend/src/scripts/startProd.js"]
