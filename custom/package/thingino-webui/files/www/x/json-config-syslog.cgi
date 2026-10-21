#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

DOMAIN="rsyslog"
CONFIG_FILE="/etc/thingino.json"
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

write_config() {
  ensure_config
  TMP_FILE=$(mktemp /tmp/${DOMAIN}.XXXXXX)
  echo '{}' >"$TMP_FILE"
  jct "$TMP_FILE" set "$DOMAIN.enabled" "$enabled" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.host" "$host" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.port" "$port" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.file" "$file" >/dev/null 2>&1
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
  send_json "$(read_domain_json)"
}

handle_post() {
  read_body
  new_enabled=$(jct "$REQ_FILE" get enabled 2>/dev/null)
  new_host=$(jct "$REQ_FILE" get host 2>/dev/null)
  new_port=$(jct "$REQ_FILE" get port 2>/dev/null)
  new_file=$(jct "$REQ_FILE" get file 2>/dev/null)

  enabled=$(normalize_bool "$new_enabled") || \
    json_error 422 "Invalid boolean value" "422 Unprocessable Entity"
  file=$(normalize_bool "$new_file") || \
    json_error 422 "Invalid boolean value" "422 Unprocessable Entity"
  host=$(strip_json_string "$new_host")
  port=$(strip_json_string "$new_port")

  [ -n "$port" ] || port="514"

  if [ "$enabled" = "true" ] && [ -z "$host" ]; then
    json_error 422 "Remote host cannot be empty when enabled" "422 Unprocessable Entity"
  fi

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
