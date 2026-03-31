FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/inventory/package.json ./services/inventory/
RUN cd services/inventory && npm install --production

COPY services/inventory/src/ ./services/inventory/src/

EXPOSE 3006

WORKDIR /app/services/inventory

CMD ["node", "src/index.js"]
