#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

REQ_FILE=""

cleanup() {
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

strip_json_string() {
  local value
  case "$1" in
    ""|null)
      printf ''
      ;;
    *)
      value="$1"
      value="${value#\"}"
      value="${value%\"}"
      printf '%s' "$value"
      ;;
  esac
}

read_body() {
  REQ_FILE=$(mktemp /tmp/firmware-reset.XXXXXX)
  # head -c 为缓冲读取；dd bs=1 每字节一次系统调用，KB 级报文会明显变慢
  if [ -n "$CONTENT_LENGTH" ]; then
    case "$CONTENT_LENGTH" in
      *[!0-9]*) json_error 400 "Invalid Content-Length header" "400 Bad Request" ;;
    esac
    if [ "$CONTENT_LENGTH" -eq 0 ]; then
      json_error 400 "Empty request body" "400 Bad Request"
    fi
    head -c "$CONTENT_LENGTH" >"$REQ_FILE"
  else
    cat >"$REQ_FILE"
  fi
  [ -s "$REQ_FILE" ] || json_error 400 "Empty request body" "400 Bad Request"
}

resolve_action() {
  case "$1" in
    wipeoverlay)
      action_label="Wipe overlay"
      action_description="Erase data stored in the overlay partition."
      action_command="flash_eraseall -j /dev/mtd2"
      action_reboot="true"
      ;;
    fullreset)
      action_label="Reset firmware"
      action_description="Restore firmware to factory defaults."
      action_command="firstboot -f"
      action_reboot="true"
      ;;
    *)
      return 1
      ;;
  esac
}

handle_get() {
  send_json '{"actions":[{"id":"wipeoverlay","label":"Wipe overlay","description":"Erase data stored in the overlay partition."},{"id":"fullreset","label":"Reset firmware","description":"Restore firmware to factory defaults."}]}'
}

handle_post() {
  read_body
  action_raw=$(jct "$REQ_FILE" get action 2>/dev/null)
  action=$(strip_json_string "$action_raw")

  [ -n "$action" ] || json_error 422 "Action is required" "422 Unprocessable Entity"

  if ! resolve_action "$action"; then
    json_error 422 "Unknown action: $action" "422 Unprocessable Entity"
  fi

  payload=$(printf '{"action":"%s","label":"%s","description":"%s","command":"%s","reboot":%s}' \
    "$(json_escape "$action")" \
    "$(json_escape "$action_label")" \
    "$(json_escape "$action_description")" \
    "$(json_escape "$action_command")" \
    "$action_reboot")

  send_json "$payload"
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

