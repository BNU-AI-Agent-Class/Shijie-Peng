FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY hcai-radar-zh.html hcai-radar-en.html 论文看板prd.md ./

RUN node scripts/seed.js

EXPOSE 3000
CMD ["node", "src/backend/server.js"]
