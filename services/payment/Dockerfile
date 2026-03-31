FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/payment/package.json ./services/payment/
RUN cd services/payment && npm install --production

COPY services/payment/src/ ./services/payment/src/

EXPOSE 3007

WORKDIR /app/services/payment

CMD ["node", "src/index.js"]
