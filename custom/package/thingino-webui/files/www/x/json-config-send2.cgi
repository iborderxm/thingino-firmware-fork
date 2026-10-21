#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

SEND2_CONFIG="/etc/send2.json"
PRUDYNT_JSON="/etc/prudynt.json"
REQ_FILE=""

emit_json() {
  local status="$1"
  shift
  [ -n "$status" ] && printf 'Status: %s\r\n' "$status"
  printf 'Content-Type: application/json\r\n'
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf 'Connection: close\r\n'
  printf '\r\n'
  printf '%s\n' "$1"
  exit 0
}

json_escape() {
  printf '%s' "$1" | sed \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g' \
    -e 's/\r/\\r/g' \
    -e 's/\n/\\n/g'
}

json_error() {
  local status=${1:-"400 Bad Request"} text="$2" code=${3:-error}
  emit_json "$status" "$(printf '{"error":{"code":"%s","message":"%s"}}' "$(json_escape "$code")" "$(json_escape "$text")")"
}

# jct 是读写配置的唯一工具，缺失时直接报错而不是静默失败
command -v jct >/dev/null 2>&1 || \
  json_error "500 Internal Server Error" "jct is not available" "jct_missing"

cleanup() {
  [ -n "$REQ_FILE" ] && [ -f "$REQ_FILE" ] && rm -f "$REQ_FILE"
}

trap cleanup EXIT

read_body() {
  REQ_FILE=$(mktemp /tmp/json-config-send2.XXXXXX)
  # head -c 为缓冲读取；dd bs=1 每字节一次系统调用，KB 级报文会明显变慢
  if [ -n "$CONTENT_LENGTH" ]; then
    case "$CONTENT_LENGTH" in
      *[!0-9]*) json_error "400 Bad Request" "Invalid Content-Length header" "invalid_content_length" ;;
    esac
    if [ "$CONTENT_LENGTH" -eq 0 ]; then
      json_error "400 Bad Request" "Empty request body" "empty_body"
    fi
    head -c "$CONTENT_LENGTH" >"$REQ_FILE"
  else
    cat >"$REQ_FILE"
  fi
  [ -s "$REQ_FILE" ] || json_error "400 Bad Request" "Empty request body" "empty_body"
}

ensure_send2_file() {
  [ -f "$SEND2_CONFIG" ] && return
  local old_umask
  old_umask=$(umask)
  umask 077
  echo '{}' >"$SEND2_CONFIG"
  umask "$old_umask"
}

ensure_prudynt_file() {
  [ -f "$PRUDYNT_JSON" ] && return
  local old_umask
  old_umask=$(umask)
  umask 077
  echo '{}' >"$PRUDYNT_JSON"
  umask "$old_umask"
}

load_send2_config() {
  ensure_send2_file
  cat "$SEND2_CONFIG"
}

load_motion_block() {
  [ -f "$PRUDYNT_JSON" ] || { echo '{}'; return; }
  local data
  data=$(jct "$PRUDYNT_JSON" get motion 2>/dev/null)
  if [ -z "$data" ] || [ "$data" = "null" ]; then
    echo '{}'
  else
    echo "$data"
  fi
}

collect_mounts() {
  local sep="" entry
  printf '['
  awk '/cif|fat|nfs|smb/ {print $2}' /etc/mtab 2>/dev/null | while IFS= read -r entry; do
    printf '%s"%s"' "$sep" "$(json_escape "$entry")"
    sep=','
  done
  printf ']'
}

meta_payload() {
  local hostname camera mounts mqtt
  hostname=$(hostname -s 2>/dev/null)
  [ -n "$hostname" ] || hostname=$(hostname 2>/dev/null)
  camera=${network_macaddr//:/}
  mounts=$(collect_mounts)
  if [ -x /usr/bin/mosquitto_pub ]; then
    mqtt="true"
  else
    mqtt="false"
  fi
  printf '{"hostname":"%s","camera_id":"%s","mqtt_available":%s,"mounts":%s}' \
    "$(json_escape "$hostname")" "$(json_escape "$camera")" "$mqtt" "$mounts"
}

apply_send2_payload() {
  local payload="$1" tmp
  tmp=$(mktemp /tmp/json-config-send2-config.XXXXXX)
  printf '%s' "$payload" >"$tmp"
  ensure_send2_file
  if ! jct "$SEND2_CONFIG" import "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    json_error "400 Bad Request" "Unable to apply send2 configuration." "invalid_config"
  fi
  rm -f "$tmp"
}

apply_motion_payload() {
  local payload="$1" tmp
  tmp=$(mktemp /tmp/json-config-send2-motion.XXXXXX)
  printf '{"motion":%s}' "$payload" >"$tmp"
  ensure_prudynt_file
  if ! jct "$PRUDYNT_JSON" import "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    json_error "400 Bad Request" "Unable to apply motion configuration." "invalid_motion"
  fi
  rm -f "$tmp"
}

handle_get() {
  local config motion meta
  config=$(load_send2_config)
  motion=$(load_motion_block)
  meta=$(meta_payload)
  emit_json "" "$(printf '{"config":%s,"motion":%s,"meta":%s}' "$config" "$motion" "$meta")"
}

handle_post() {
  read_body
  local config_payload motion_payload changed_config="false" changed_motion="false"
  config_payload=$(jct "$REQ_FILE" get config 2>/dev/null)
  motion_payload=$(jct "$REQ_FILE" get motion 2>/dev/null)

  if { [ -z "$config_payload" ] || [ "$config_payload" = "null" ]; } && \
     { [ -z "$motion_payload" ] || [ "$motion_payload" = "null" ]; }; then
    json_error "400 Bad Request" "Request missing config or motion payload." "missing_payload"
  fi

  if [ -n "$config_payload" ] && [ "$config_payload" != "null" ]; then
    apply_send2_payload "$config_payload"
    changed_config="true"
  fi

  if [ -n "$motion_payload" ] && [ "$motion_payload" != "null" ]; then
    apply_motion_payload "$motion_payload"
    changed_motion="true"
  fi

  local response
  response=$(printf '{"ok":true,"configUpdated":%s,"motionUpdated":%s}' "$changed_config" "$changed_motion")
  emit_json "" "$response"
}

case "$REQUEST_METHOD" in
  GET|HEAD)
    handle_get
    ;;
  POST|PUT|PATCH)
    handle_post
    ;;
  *)
    json_error "405 Method Not Allowed" "Unsupported method" "method_not_allowed"
    ;;
esac
