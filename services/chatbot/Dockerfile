FROM node:20-alpine

WORKDIR /app

COPY shared/ ./shared/
RUN cd shared && npm install --production

COPY services/chatbot/package.json ./services/chatbot/
RUN cd services/chatbot && npm install --production

COPY services/chatbot/src/ ./services/chatbot/src/

EXPOSE 3008

WORKDIR /app/services/chatbot

CMD ["node", "src/index.js"]
