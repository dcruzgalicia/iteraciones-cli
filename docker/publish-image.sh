#!/bin/sh
set -eu

IMAGE="${1:?uso: docker/publish-image.sh registry.gitlab.com/grupo/repo/iteraciones-build:tag}"
PANDOC_VERSION="${PANDOC_VERSION:-3.14}"

docker build --platform linux/amd64 --build-arg "PANDOC_VERSION=${PANDOC_VERSION}" -f docker/iteraciones-build.Dockerfile -t "${IMAGE}" .
docker push "${IMAGE}"
