FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dealer_api_node.js ./

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["npm", "start"]
