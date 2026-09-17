FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs clarification-review.mjs request-body.mjs ./
COPY lib ./lib
COPY data ./data
CMD ["npm", "start"]
