#!/bin/sh
# shellcheck disable=SC2039

# Check authentication
. /var/www/x/auth.sh
require_auth

http_200() {
  printf 'Status: 200 OK\r\n'
}

http_400() {
  printf 'Status: 400 Bad Request\r\n'
}

http_412() {
  printf 'Status: 412 Precondition Failed\r\n'
}

json_header() {
  printf 'Content-Type: application/json\r\n'
  printf 'Pragma: no-cache\r\n'
  printf 'Expires: %s\r\n' "$(TZ=GMT0 date +'%a, %d %b %Y %T %Z')"
  printf 'Etag: "%s"\r\n' "$(cat /proc/sys/kernel/random/uuid)"
  printf 'Connection: close\r\n'
  printf '\r\n'
}

json_error() {
  http_412
  json_header
  printf '{"error":{"code":412,"message":"%s"}}
' "$1"
  exit 0
}

json_ok() {
  http_200
  json_header
  if [ "{" = "${1:0:1}" ]; then
    printf '{"code":200,"result":"success","message":%s}
' "$1"
  else
    printf '{"code":200,"result":"success","message":"%s"}
' "$1"
  fi
  exit 0
}

bad_request() {
  http_400
  printf '\r\n'
  printf '%s\n' "$1"
  exit 1
}

# Read POST data（按 CONTENT_LENGTH 精确读取，兼容无换行/多行报文体；
# 原 read -r 只能读到第一行）
if [ -n "$CONTENT_LENGTH" ]; then
  case "$CONTENT_LENGTH" in
    *[!0-9]*) POST_DATA="" ;;
    *) POST_DATA=$(head -c "$CONTENT_LENGTH") ;;
  esac
else
  POST_DATA=$(cat)
fi

# Parse JSON (supports quoted or numeric val)
cmd=$(printf '%s' "$POST_DATA" | awk -F'"' '/"cmd"/{for(i=1;i<=NF;i++){if($i=="cmd"){print $(i+2); exit}}}')
val=$(printf '%s' "$POST_DATA" | sed -n 's/.*"val"[[:space:]]*:[[:space:]]*"\{0,1\}\([^",}]*\).*/\1/p')

[ -z "$cmd" ] && bad_request "missing required parameter cmd"
[ -z "$val" ] && bad_request "missing required parameter val"

case "$cmd" in
  auto)
    echo '{"daynight":{"enabled":true}}' | prudyntctl json - >/dev/null 2>&1
    ;;
  color)
    echo "{\"daynight\":{\"enabled\":false},\"image\":{\"running_mode\": $val}}" | prudyntctl json - >/dev/null 2>&1
    ;;
  daynight)
    echo "{\"daynight\":{\"enabled\":false,\"force_mode\":\"$val\"}}" | prudyntctl json - >/dev/null 2>&1
    ;;
  ir850 | ir940 | white)
    echo '{"daynight":{"enabled":false}}' | prudyntctl json - >/dev/null 2>&1
    light $cmd $val
    ;;
  ircut)
    echo '{"daynight":{"enabled":false}}' | prudyntctl json - >/dev/null 2>&1
    ircut $val >/dev/null
    ;;
esac

# All state data is provided by heartbeat, no need to build payload here
json_ok
