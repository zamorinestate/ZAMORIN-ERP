# Production Dockerfile — Zamorin Cafe ERP (v1.1.0)
FROM node:24-alpine AS base

WORKDIR /app

# Install backend dependencies
COPY Backend/package*.json ./Backend/
RUN cd Backend && npm ci --only=production

# Copy backend source code
COPY Backend ./Backend
COPY Frontend ./Frontend

ENV NODE_ENV=production
ENV PORT=4000
ENV TZ=Asia/Kolkata

EXPOSE 4000 3000

CMD ["node", "Backend/src/scripts/startProd.js"]
