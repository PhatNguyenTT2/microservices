FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/statistics/package.json ./services/statistics/
RUN cd services/statistics && npm install --production

COPY services/statistics/src/ ./services/statistics/src/

EXPOSE 3009

WORKDIR /app/services/statistics

CMD ["node", "src/index.js"]
