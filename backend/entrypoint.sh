#!/bin/sh
# Ensure the upload inbox directory exists before starting the server.
# This runs as root (inside the container) so it can create the directory
# even when the /data/archive volume mount is empty on first launch.
mkdir -p /data/archive/inbox
exec "$@"
