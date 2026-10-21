#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

DOMAIN="webui"
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
  jct "$TMP_FILE" set "$DOMAIN.theme" "$theme" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.paranoid" "$paranoid" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.track_focus" "$track_focus" >/dev/null 2>&1
  jct "$TMP_FILE" set "$DOMAIN.focus_timeout" "$focus_timeout" >/dev/null 2>&1
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
normalize_theme() {
  case "$1" in
    light|dark|auto) printf '%s' "$1" ;;
    ""|null) printf 'auto' ;;
    *) return 1 ;;
  esac
}

normalize_bool() {
  case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in
    1|true|yes|on) printf 'true' ;;
    0|false|no|off|""|null) printf 'false' ;;
    *) return 1 ;;
  esac
}

normalize_int() {
  val="$1"
  min="$2"
  max="$3"

  case "$val" in
    ""|null) printf '0' ;;
    *[!0-9]*) return 1 ;;
    *)
      if [ -n "$min" ] && [ "$val" -lt "$min" ]; then
        printf '%s' "$min"
      elif [ -n "$max" ] && [ "$val" -gt "$max" ]; then
        printf '%s' "$max"
      else
        printf '%s' "$val"
      fi
      ;;
  esac
}

handle_get() {
  send_json "$(read_domain_json)"
}

handle_post() {
  read_body
  new_theme=$(jct "$REQ_FILE" get theme 2>/dev/null)
  new_paranoid=$(jct "$REQ_FILE" get paranoid 2>/dev/null)
  new_track_focus=$(jct "$REQ_FILE" get track_focus 2>/dev/null)
  new_focus_timeout=$(jct "$REQ_FILE" get focus_timeout 2>/dev/null)
  new_password=$(jct "$REQ_FILE" get password 2>/dev/null)

  theme=$(normalize_theme "$new_theme") || \
    json_error 422 "Unsupported theme" "422 Unprocessable Entity"
  paranoid=$(normalize_bool "$new_paranoid") || \
    json_error 422 "Invalid boolean value" "422 Unprocessable Entity"
  track_focus=$(normalize_bool "$new_track_focus") || \
    json_error 422 "Invalid boolean value" "422 Unprocessable Entity"
  focus_timeout=$(normalize_int "$new_focus_timeout" 0 300) || \
    json_error 422 "Invalid integer value" "422 Unprocessable Entity"

  write_config

  if [ -n "$new_password" ]; then
    if command -v chpasswd >/dev/null 2>&1; then
      printf '%s:%s\n' "root" "$new_password" | chpasswd -c sha512 >/dev/null 2>&1 || json_error 500 "Failed to update password" "500 Internal Server Error"

      # Update session to mark password as no longer default
      if [ -n "$SESSION_ID" ]; then
        session_file="/tmp/sessions/$SESSION_ID"
        if [ -f "$session_file" ]; then
          sed -i "s/^is_default_password=.*/is_default_password=false/" "$session_file"
        fi
      fi
    else
      json_error 500 "Password tool missing" "500 Internal Server Error"
    fi
  fi

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
