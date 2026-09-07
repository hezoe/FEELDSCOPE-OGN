#!/bin/bash
set -e

IMG="/work/ogn-image.img"
KERNEL="/work/kernel-qemu-4.19.50-buster"
DTB="/work/versatile-pb-buster.dtb"

# Kernel and DTB should be pre-mounted into /work/
# From: https://github.com/dhruvvyas90/qemu-rpi-kernel

if [ ! -f "$IMG" ]; then
    echo "ERROR: OGN image not found at $IMG"
    echo "Mount it with: -v /path/to/image.img:/work/ogn-image.img"
    exit 1
fi

# Resize the image to give more space (add 2GB)
echo "=== Resizing image (adding 2GB) ==="
cp "$IMG" /work/ogn-boot.img
qemu-img resize /work/ogn-boot.img +2G

# Fix partition table to use all available space
echo "=== Expanding root partition ==="
# Get current partition info
PART2_START=$(fdisk -l /work/ogn-boot.img | grep img2 | awk '{print $2}')
echo "Root partition starts at sector: $PART2_START"

# Delete and recreate partition 2 to fill disk
(
echo d      # delete
echo 2      # partition 2
echo n      # new
echo p      # primary
echo 2      # partition 2
echo $PART2_START  # same start
echo        # default end (use all space)
echo w      # write
) | fdisk /work/ogn-boot.img || true

echo "=== Modifying image for QEMU compatibility ==="

# Mount boot partition to modify cmdline.txt and config.txt
BOOT_OFFSET=$((8192 * 512))
mkdir -p /mnt/boot
mount -o loop,offset=$BOOT_OFFSET /work/ogn-boot.img /mnt/boot

# Check what's in boot partition
echo "=== Boot partition contents ==="
ls /mnt/boot/

# Show current cmdline
echo "=== Current cmdline.txt ==="
cat /mnt/boot/cmdline.txt 2>/dev/null || echo "(not found)"

# Modify cmdline.txt for QEMU (use /dev/sda2 instead of mmcblk0p2)
if [ -f /mnt/boot/cmdline.txt ]; then
    sed -i 's|root=/dev/mmcblk0p2|root=/dev/sda2|g' /mnt/boot/cmdline.txt
    echo "=== Modified cmdline.txt ==="
    cat /mnt/boot/cmdline.txt
fi

umount /mnt/boot

# Fix /etc/fstab in root partition to use /dev/sda
ROOT_OFFSET=$((532480 * 512))
mkdir -p /mnt/root

# Check filesystem first
echo "=== Checking root filesystem ==="
e2fsck -f -y /work/ogn-boot.img -E offset=$ROOT_OFFSET || true

# Resize filesystem to fill expanded partition
echo "=== Resizing root filesystem ==="
LOOP_DEV=$(losetup --find --show -o $ROOT_OFFSET /work/ogn-boot.img)
resize2fs "$LOOP_DEV" || true

mount "$LOOP_DEV" /mnt/root

echo "=== Current /etc/fstab ==="
cat /mnt/root/etc/fstab 2>/dev/null || echo "(not found)"

# Replace mmcblk0 references with sda
if [ -f /mnt/root/etc/fstab ]; then
    sed -i 's|/dev/mmcblk0p|/dev/sda|g' /mnt/root/etc/fstab
    echo "=== Modified /etc/fstab ==="
    cat /mnt/root/etc/fstab
fi

# Disable kernel modules that won't work in QEMU
# Comment out hardware-specific modules in /etc/modules
if [ -f /mnt/root/etc/modules ]; then
    echo "=== /etc/modules ==="
    cat /mnt/root/etc/modules
fi

# Enable serial console for login
if [ -d /mnt/root/etc/systemd/system ]; then
    # Ensure getty on serial
    mkdir -p /mnt/root/etc/systemd/system/getty.target.wants
    ln -sf /lib/systemd/system/serial-getty@.service \
        /mnt/root/etc/systemd/system/getty.target.wants/serial-getty@ttyAMA0.service 2>/dev/null || true
fi

# Reset pi user password to 'pi' for QEMU access
echo "=== Setting pi password to 'pi' ==="
HASH=$(openssl passwd -6 'pi')
echo "=== Generated hash: $HASH ==="
echo "=== Current shadow entry ==="
grep '^pi:' /mnt/root/etc/shadow
# Replace everything between first and second colon
sed -i "s|^pi:[^:]*:|pi:${HASH}:|" /mnt/root/etc/shadow
echo "=== Updated shadow entry ==="
grep '^pi:' /mnt/root/etc/shadow

# Also reset root password
HASH_ROOT=$(openssl passwd -6 'root')
sed -i "s|^root:[^:]*:|root:${HASH_ROOT}:|" /mnt/root/etc/shadow

# Enable SSH password authentication
if [ -f /mnt/root/etc/ssh/sshd_config ]; then
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /mnt/root/etc/ssh/sshd_config
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /mnt/root/etc/ssh/sshd_config
    sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /mnt/root/etc/ssh/sshd_config
    echo "=== SSH config updated ==="
    grep -E 'PasswordAuthentication|PermitRootLogin' /mnt/root/etc/ssh/sshd_config
fi

# Generate and deploy SSH key for passwordless access
echo "=== Setting up SSH key ==="
ssh-keygen -t ed25519 -f /work/qemu-key -N '' -q 2>/dev/null || true
mkdir -p /mnt/root/home/pi/.ssh
cp /work/qemu-key.pub /mnt/root/home/pi/.ssh/authorized_keys
chmod 700 /mnt/root/home/pi/.ssh
chmod 600 /mnt/root/home/pi/.ssh/authorized_keys
chown -R 1000:1000 /mnt/root/home/pi/.ssh
echo "SSH key deployed."

# Show some useful info
echo "=== /etc/hostname ==="
cat /mnt/root/etc/hostname 2>/dev/null || echo "(not found)"

echo "=== Users with shells ==="
grep -v nologin /mnt/root/etc/passwd 2>/dev/null | grep -v false || true

umount /mnt/root
losetup -d "$LOOP_DEV"

echo ""
echo "============================================"
echo "  Starting QEMU RPi emulation"
echo "  SSH will be available on port 5022"
echo "  Press Ctrl-A X to quit QEMU"
echo "============================================"
echo ""

# Boot with QEMU
# Using versatile-pb machine (well-supported for 32-bit ARM)
qemu-system-arm \
    -M versatilepb \
    -cpu arm1176 \
    -m 256 \
    -kernel "$KERNEL" \
    -dtb "$DTB" \
    -drive "file=/work/ogn-boot.img,format=raw" \
    -append "root=/dev/sda2 panic=1 rootfstype=ext4 rw console=ttyAMA0" \
    -net nic \
    -net user,hostfwd=tcp::5022-:22,hostfwd=tcp::8080-:80 \
    -no-reboot \
    -nographic \
    -serial mon:stdio
