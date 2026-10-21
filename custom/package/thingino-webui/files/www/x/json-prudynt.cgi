#!/bin/sh
# BusyBox httpd CGI for JSON API
# Forwards the JSON request body to prudyntctl (in-memory config
# get/set proxy) and returns the daemon's JSON reply to the client

# Check authentication
. /var/www/x/auth.sh
require_auth

send_json() {
  printf "Content-Type: application/json\r\n"
  printf "Cache-Control: no-store\r\n"
  printf "Connection: close\r\n"
  printf "\r\n"
  printf "%s\n" "$1"
}

send_error() {
  # $1 = HTTP status line (e.g. "400 Bad Request"), $2 = JSON error body
  printf "Status: %s\r\n" "$1"
  printf "Content-Type: application/json\r\n"
  printf "Cache-Control: no-store\r\n"
  printf "Connection: close\r\n"
  printf "\r\n"
  printf "%s\n" "$2"
  exit 0
}

# The daemon control tool must be present
command -v prudyntctl >/dev/null 2>&1 || \
  send_error "500 Internal Server Error" '{"error":"prudyntctl is not available"}'

# Read exactly CONTENT_LENGTH bytes if provided; otherwise read all stdin.
# head -c does buffered reads; dd bs=1 would need one syscall per byte and
# stalls for seconds on multi-KB prudynt payloads.
if [ -n "$CONTENT_LENGTH" ]; then
  case "$CONTENT_LENGTH" in
    *[!0-9]*) send_error "400 Bad Request" '{"error":"Invalid Content-Length header"}' ;;
  esac
  if [ "$CONTENT_LENGTH" -eq 0 ]; then
    send_error "400 Bad Request" '{"error":"Empty request body"}'
  fi
  body=$(head -c "$CONTENT_LENGTH")
else
  body=$(cat)
fi

[ -n "$body" ] || send_error "400 Bad Request" '{"error":"Empty request body"}'

# Forward to the daemon. Capture the reply first so a failure can still be
# reported as well-formed JSON instead of a truncated body with status 200.
if ! response=$(printf '%s' "$body" | prudyntctl json - 2>/dev/null); then
  send_error "500 Internal Server Error" '{"error":"prudyntctl failed to process the request"}'
fi

# The daemon may reply with nothing on success; keep the body valid JSON
[ -n "$response" ] || response='{}'

send_json "$response"
