FROM node:22-bookworm-slim AS node
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ sqlite3 nginx openssh-server openssh-client sudo rsync jq shellcheck && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/ /usr/local/
RUN ln -s /usr/local/bin/node /usr/bin/node
WORKDIR /lab
CMD ["bash"]
