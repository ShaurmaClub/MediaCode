FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends qemu-system-x86 qemu-utils cloud-image-utils openssh-client curl ca-certificates rsync jq && rm -rf /var/lib/apt/lists/*
WORKDIR /vm
CMD ["sleep", "infinity"]
