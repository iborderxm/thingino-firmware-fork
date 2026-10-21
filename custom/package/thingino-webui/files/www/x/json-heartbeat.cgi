#!/bin/sh

# Optimized SSE heartbeat - streams from daemon-maintained cache

# Check authentication
. /var/www/x/auth.sh
require_auth

CACHE_FILE="/tmp/heartbeat_cache.json"

# Validate the interval: a non-numeric or zero value would break the retry
# arithmetic ($((...)) fails, %d printf fails) and kill the stream on the
# very first event instead of streaming
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-1}"
case "$HEARTBEAT_INTERVAL" in
  ''|*[!0-9]*) HEARTBEAT_INTERVAL=1 ;;
esac
[ "$HEARTBEAT_INTERVAL" -lt 1 ] && HEARTBEAT_INTERVAL=1
HEARTBEAT_RETRY_MS=$((HEARTBEAT_INTERVAL * 1000))

http_200() {
  printf 'Status: 200 OK\r\n'
}

send_headers() {
  http_200
  printf 'Content-Type: text/event-stream\r\n'
  printf 'Cache-Control: no-cache\r\n'
  printf '\r\n'
}

stream_heartbeat() {
  while true; do
    printf 'retry: %d\n' "$HEARTBEAT_RETRY_MS" || exit 0

    # The daemon updates the cache atomically (write tmp + mv), so a
    # successful read always yields one complete JSON line. If the daemon
    # is not running (or the cache is unreadable/empty), emit an error
    # event and keep streaming - the stream recovers by itself once the
    # daemon writes the cache again.
    cache_data=""
    if [ -r "$CACHE_FILE" ]; then
      cache_data=$(cat "$CACHE_FILE" 2>/dev/null)
    fi

    if [ -n "$cache_data" ]; then
      printf 'data: %s\n\n' "$cache_data" || exit 0
    else
      printf 'data: {"error":"Heartbeat daemon not running"}\n\n' || exit 0
    fi

    sleep "$HEARTBEAT_INTERVAL" || exit 0
  done
}

trap 'exit 0' INT TERM PIPE HUP
send_headers
stream_heartbeat
