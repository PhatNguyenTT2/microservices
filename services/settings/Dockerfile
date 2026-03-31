FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/settings/package.json ./services/settings/
RUN cd services/settings && npm install --production

COPY services/settings/src/ ./services/settings/src/

EXPOSE 3004

WORKDIR /app/services/settings

CMD ["node", "src/index.js"]
