FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY rd-auto.js .

EXPOSE 3000

CMD ["node", "rd-auto.js"]