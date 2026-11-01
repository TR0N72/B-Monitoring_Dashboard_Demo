FROM node:20-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN chown -R node:node /app

USER node

EXPOSE 3000
CMD ["npm", "start"]