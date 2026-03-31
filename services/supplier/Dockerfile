FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/supplier/package.json ./services/supplier/
RUN cd services/supplier && npm install --production

COPY services/supplier/src/ ./services/supplier/src/

EXPOSE 3005

WORKDIR /app/services/supplier

CMD ["node", "src/index.js"]
