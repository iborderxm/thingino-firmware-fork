#!/bin/sh

. /var/www/x/auth.sh
require_auth

DOMAIN="opc"
CONFIG_FILE="/etc/opc.json"
TMP_FILE=""
REQ_FILE=""

cleanup() {
  [ -n "$TMP_FILE" ] && rm -f "$TMP_FILE"
  [ -n "$REQ_FILE" ] && rm -f "$REQ_FILE"
}
trap cleanup EXIT

json_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g' \
    -e "s/\r/\\r/g" \
    -e "s/\n/\\n/g"
}

send_json() {
  status="${2:-200 OK}"
  printf 'Status: %s\n' "$status"
  cat <<EOF
Content-Type: application/json
Cache-Control: no-store
Pragma: no-cache

$1
EOF
  exit 0
}

json_error() {
  code="${1:-400}"
  message="$2"
  send_json "{\"error\":{\"code\":$code,\"message\":\"$(json_escape "$message")\"}}" "${3:-400 Bad Request}"
}

strip_json_string() {
  local value
  case "$1" in
    ""|null)
      printf ''
      ;;
    *)
      value="$1"
      value=$(printf '%s' "$value" | sed -e 's/^"//' -e 's/"$//' -e 's/^\\"//' -e 's/\\"$//')
      printf '%s' "$value"
      ;;
  esac
}

ensure_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    umask 077
    echo '{}' >"$CONFIG_FILE"
  fi
}

read_config_json() {
  ensure_config
  if [ -r "$CONFIG_FILE" ]; then
    cat "$CONFIG_FILE"
  else
    printf '{}'
  fi
}

write_config() {
  ensure_config
  TMP_FILE=$(mktemp /tmp/${DOMAIN}.XXXXXX)
  echo '{}' >"$TMP_FILE"
  
  [ -n "$server_ip" ] && jct "$TMP_FILE" set server_ip "$server_ip" >/dev/null 2>&1
  [ -n "$server_port" ] && jct "$TMP_FILE" set server_port "$server_port" >/dev/null 2>&1
  [ -n "$auth_key" ] && jct "$TMP_FILE" set auth_key "$auth_key" >/dev/null 2>&1
  
  cp -f "$TMP_FILE" "$CONFIG_FILE" >/dev/null 2>&1
  chmod 600 "$CONFIG_FILE" 2>/dev/null
}

read_body() {
  REQ_FILE=$(mktemp /tmp/${DOMAIN}-req.XXXXXX)
  if [ -n "$CONTENT_LENGTH" ]; then
    dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null >"$REQ_FILE"
  else
    cat >"$REQ_FILE"
  fi
}

handle_get() {
  send_json "$(read_config_json)"
}

handle_post() {
  read_body
  new_server_ip=$(jct "$REQ_FILE" get server_ip 2>/dev/null)
  new_server_port=$(jct "$REQ_FILE" get server_port 2>/dev/null)
  new_auth_key=$(jct "$REQ_FILE" get auth_key 2>/dev/null)

  server_ip=$(strip_json_string "$new_server_ip")
  server_port=$(strip_json_string "$new_server_port")
  auth_key=$(strip_json_string "$new_auth_key")

  [ -n "$server_ip" ] || json_error 422 "server_ip cannot be empty" "422 Unprocessable Entity"
  [ -n "$server_port" ] || json_error 422 "server_port cannot be empty" "422 Unprocessable Entity"
  [ -n "$auth_key" ] || json_error 422 "auth_key cannot be empty" "422 Unprocessable Entity"

  write_config

  send_json '{"status":"ok"}'
}

case "$REQUEST_METHOD" in
  GET|"")
    handle_get
    ;;
  POST)
    handle_post
    ;;
  *)
    json_error 405 "Method not allowed" "405 Method Not Allowed"
    ;;
esac
