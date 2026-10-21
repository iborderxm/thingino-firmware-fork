#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

DOMAIN="wireguard"
CONFIG_FILE="/etc/thingino.json"
TMP_FILE=""
REQ_FILE=""
WG_DEV="wg0"

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

# jct 是读写配置的唯一工具，缺失时直接报错而不是静默失败
command -v jct >/dev/null 2>&1 || \
  json_error 500 "jct is not available" "500 Internal Server Error"

ensure_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    umask 077
    echo '{}' >"$CONFIG_FILE"
  fi
}

read_domain_json() {
  ensure_config
  local data
  data=$(jct "$CONFIG_FILE" get "$DOMAIN" 2>/dev/null)
  case "$data" in
    ""|null)
      data='{}'
      ;;
  esac
  printf '%s' "$data"
}

append_json_field() {
  local json="$1"
  local key="$2"
  local value="$3"
  local mode="${4:-string}"

  json=$(printf '%s' "$json" | tr -d '\n')
  [ -n "$json" ] || json='{}'

  local head tail sep formatted
  head="${json%?}"
  tail="}"
  if [ "$json" = '{}' ]; then
    head='{'
    sep=''
  else
    sep=','
  fi

  if [ "$mode" = "raw" ]; then
    formatted="$value"
  else
    formatted="\"$(json_escape "$value")\""
  fi

  printf '%s%s"%s":%s%s' "$head" "$sep" "$key" "$formatted" "$tail"
}

is_wg_up() {
  ip link show "$WG_DEV" 2>/dev/null | grep -q UP
}

write_config() {
  ensure_config
  TMP_FILE=$(mktemp /tmp/${DOMAIN}.XXXXXX)
  echo '{}' >"$TMP_FILE"
  jct "$TMP_FILE" set "$DOMAIN.enabled" "$enabled" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.address" "$address" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.allowed" "$allowed" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.dns" "$dns" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.endpoint" "$endpoint" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.keepalive" "$keepalive" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.mtu" "$mtu" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.peerpsk" "$peerpsk" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.peerpub" "$peerpub" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.port" "$port" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.privkey" "$privkey" >/dev/null 2>&1
  jct "$CONFIG_FILE" import "$TMP_FILE" >/dev/null 2>&1
}

read_body() {
  REQ_FILE=$(mktemp /tmp/${DOMAIN}-req.XXXXXX)
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

# 校验函数只做“返回非零 + 不输出”，由调用方在主 shell 里报错。
# 注意：不能在函数内部调用 json_error——这些函数经 $(...) 在子 shell
# 中执行，exit 只会退出子 shell，错误响应会被捕获进变量、配置被写入
# 垃圾值，而客户端最终收到的是 200 {"status":"ok"}。
normalize_bool() {
  case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in
    1|true|yes|on) printf 'true' ;;
    0|false|no|off|""|null) printf 'false' ;;
    *) return 1 ;;
  esac
}

handle_get() {
  local payload wg_status wg_supported
  payload=$(read_domain_json)
  wg_status=0
  is_wg_up && wg_status=1
  payload=$(append_json_field "$payload" "wg_status" "$wg_status" raw)
  wg_supported=$([ -f "/bin/wg" ] && echo true || echo false)
  payload=$(append_json_field "$payload" "wg_supported" "$wg_supported" raw)
  printf '%s' "$payload"
}

handle_post() {
  read_body

  enabled=$(normalize_bool "$(jct "$REQ_FILE" get enabled 2>/dev/null)") || \
    json_error 422 "Invalid boolean value" "422 Unprocessable Entity"
  address=$(jct "$REQ_FILE" get address 2>/dev/null)
  allowed=$(jct "$REQ_FILE" get allowed 2>/dev/null)
  dns=$(jct "$REQ_FILE" get dns 2>/dev/null)
  endpoint=$(jct "$REQ_FILE" get endpoint 2>/dev/null)
  keepalive=$(jct "$REQ_FILE" get keepalive 2>/dev/null)
  mtu=$(jct "$REQ_FILE" get mtu 2>/dev/null)
  peerpsk=$(jct "$REQ_FILE" get peerpsk 2>/dev/null)
  peerpub=$(jct "$REQ_FILE" get peerpub 2>/dev/null)
  port=$(jct "$REQ_FILE" get port 2>/dev/null)
  privkey=$(jct "$REQ_FILE" get privkey 2>/dev/null)

  write_config

  send_json '{"status":"ok","message":"WireGuard configuration saved"}'
}

case "$REQUEST_METHOD" in
  GET|"")
    send_json "$(handle_get)"
    ;;
  POST)
    handle_post
    ;;
  *)
    json_error 405 "Method not allowed" "405 Method Not Allowed"
    ;;
esac
