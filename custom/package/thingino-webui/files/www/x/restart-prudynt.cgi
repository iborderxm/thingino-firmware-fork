#!/bin/sh
# Restart prudynt service

# Check authentication
. /var/www/x/auth.sh
require_auth

printf 'Content-Type: application/json\r\n'
printf 'Cache-Control: no-store\r\n'
printf 'Connection: close\r\n'
printf '\r\n'
printf '{"status":"ok","message":"Prudynt restart initiated"}\n'

service restart prudynt >/dev/null 2>&1 &
