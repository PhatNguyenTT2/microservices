FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/catalog/package.json ./services/catalog/
RUN cd services/catalog && npm install --production

COPY services/catalog/src/ ./services/catalog/src/

EXPOSE 3002

WORKDIR /app/services/catalog

CMD ["node", "src/index.js"]
