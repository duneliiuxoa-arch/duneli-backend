FROM node:20-alpine

# Prisma needs OpenSSL to detect the correct engine binary on Alpine
RUN apk add --no-cache openssl libssl3

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
