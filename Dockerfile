FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    espeak-ng \
    wbritish \
    wamerican \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --break-system-packages "git+https://github.com/AfriSpeech/africa-g2p.git@main" phonemizer

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data/feedback

ENV PORT=8787
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8787

CMD ["node", "server.mjs"]
