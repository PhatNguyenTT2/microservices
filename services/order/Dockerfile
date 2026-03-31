FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/order/package.json ./services/order/
RUN cd services/order && npm install --production

COPY services/order/src/ ./services/order/src/

EXPOSE 3003

WORKDIR /app/services/order

CMD ["node", "src/index.js"]
