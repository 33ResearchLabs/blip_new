FROM node:22-alpine

WORKDIR /app

# Copy settle directory
COPY settle/package*.json ./

RUN npm install

COPY settle/ ./

# NEXT_PUBLIC_ vars are inlined at build time - must be set before next build
ARG NEXT_PUBLIC_MOCK_MODE=true
ENV NEXT_PUBLIC_MOCK_MODE=$NEXT_PUBLIC_MOCK_MODE

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
