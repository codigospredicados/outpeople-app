FROM node:22-bookworm-slim
WORKDIR /service
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./server.js
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
