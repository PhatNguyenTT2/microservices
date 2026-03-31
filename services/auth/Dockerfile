FROM node:20-alpine

WORKDIR /app

# Layout inside container:
#   /app/shared/              ← shared libraries
#   /app/services/auth/src/   ← service code

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/auth/package.json ./services/auth/
RUN cd services/auth && npm install --production

COPY services/auth/src/ ./services/auth/src/

EXPOSE 3001

WORKDIR /app/services/auth

CMD ["node", "src/index.js"]
