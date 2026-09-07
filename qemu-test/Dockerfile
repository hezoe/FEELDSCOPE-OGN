FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    qemu-system-arm \
    qemu-utils \
    fdisk \
    e2fsprogs \
    dosfstools \
    openssl \
    sshpass \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Script to prepare and boot the image
COPY boot-rpi.sh /work/boot-rpi.sh
RUN chmod +x /work/boot-rpi.sh

EXPOSE 5022 8080

CMD ["/work/boot-rpi.sh"]
