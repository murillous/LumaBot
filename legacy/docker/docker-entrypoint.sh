#!/bin/sh
set -e

echo "▶ Starting LumaBot Dashboard..."
exec node dashboard/server.js
