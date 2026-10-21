#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

json_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g' \
    -e "s/\r/\\r/g" \
    -e "s/\n/\\n/g"
}

send_json() {
  status="${2:-200 OK}"
  printf 'Status: %s\r\n' "$status"
  printf 'Content-Type: application/json\r\n'
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf 'Connection: close\r\n'
  printf '\r\n'
  printf '%s\n' "$1"
  exit 0
}

json_error() {
  code="${1:-400}"
  message="$2"
  send_json "{\"error\":{\"code\":$code,\"message\":\"$(json_escape "$message")\"}}" "${3:-400 Bad Request}"
}

overlay_usage() {
  local stat label percent state
  stat=$(df -P /overlay 2>/dev/null | awk 'NR==2 {print $5}')
  label=${stat:-0%}
  percent=$(printf '%s' "$label" | tr -cd '0-9')
  [ -n "$percent" ] || percent=0
  if [ "$percent" -ge 75 ]; then
    state="danger"
  else
    state="primary"
  fi
  printf '%s;%s;%s' "$label" "$percent" "$state"
}

overlay_listing() {
  if [ -d /overlay ]; then
    ls -Rl /overlay 2>&1
  else
    echo "/overlay directory not found"
  fi
}

handle_get() {
  usage=$(overlay_usage)
  label=$(printf '%s' "$usage" | cut -d';' -f1)
  percent=$(printf '%s' "$usage" | cut -d';' -f2)
  state=$(printf '%s' "$usage" | cut -d';' -f3)

  listing=$(overlay_listing)
  listing_b64=$(printf '%s' "$listing" | base64 | tr -d '\n')

  payload=$(cat <<EOF
{
  "usage": {
    "label": "$(json_escape "$label")",
    "percent": $percent,
    "state": "$(json_escape "$state")"
  },
  "listing_base64": "$(json_escape "$listing_b64")",
  "path": "/overlay"
}
EOF
)

  send_json "$payload"
}

case "$REQUEST_METHOD" in
  GET|"")
    handle_get
    ;;
  *)
    json_error 405 "Method not allowed" "405 Method Not Allowed"
    ;;
esac
