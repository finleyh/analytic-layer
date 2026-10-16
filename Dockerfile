# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Dependencies install at build time; the rest of the source is bind-mounted
# in by docker-compose.yml for live editing, so it isn't COPYed here.
COPY package.json package-lock.json ./
RUN npm install

CMD ["npm", "run", "dev", "--", "--port", "5173", "--strictPort"]
