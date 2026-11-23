FROM rust:1-bookworm AS pdfcheck

WORKDIR /src
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake pkg-config \
 && rm -rf /var/lib/apt/lists/*
COPY tools/pdfx-validator/Cargo.toml tools/pdfx-validator/Cargo.lock ./
COPY tools/pdfx-validator/src ./src
RUN cargo build --release

FROM oven/bun:1-debian

ARG PANDOC_VERSION=3.14
ARG MINIFY_VERSION=2.25.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      biber \
      ca-certificates \
      curl \
      ghostscript \
      git \
      imagemagick \
      latexmk \
      librsvg2-bin \
      poppler-utils \
      texlive-bibtex-extra \
      texlive-fonts-extra \
      texlive-full \
      texlive-lang-cjk \
      texlive-lang-spanish \
      texlive-latex-extra \
      texlive-luatex \
      texlive-publishers \
      texlive-xetex \
      unzip \
 && curl -fsSL -o /tmp/pandoc.deb \
      "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-amd64.deb" \
 && dpkg -i /tmp/pandoc.deb \
 && rm /tmp/pandoc.deb \
 && curl -fsSL -o /tmp/minify.tar.gz \
      "https://github.com/tdewolff/minify/releases/download/v${MINIFY_VERSION}/minify_linux_amd64.tar.gz" \
 && tar -xzf /tmp/minify.tar.gz -C /usr/local/bin minify \
 && chmod +x /usr/local/bin/minify \
 && rm /tmp/minify.tar.gz \
 && rm -rf /var/lib/apt/lists/*

COPY --from=pdfcheck /src/target/release/iteraciones-pdfcheck /usr/local/bin/iteraciones-pdfcheck
COPY docker/smoke-test.sh /usr/local/bin/smoke-test
RUN chmod +x /usr/local/bin/iteraciones-pdfcheck /usr/local/bin/smoke-test
