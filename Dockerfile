FROM node:22-alpine
WORKDIR /app

# 依存だけ先に入れてレイヤキャッシュを効かせる
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001
CMD ["npm", "run", "start"]
