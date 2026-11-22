FROM oven/bun:1-debian

ARG PANDOC_VERSION=3.14

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      imagemagick \
      librsvg2-bin \
 && curl -fsSL -o /tmp/pandoc.deb \
      "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-amd64.deb" \
 && dpkg -i /tmp/pandoc.deb \
 && rm /tmp/pandoc.deb \
 && rm -rf /var/lib/apt/lists/*
