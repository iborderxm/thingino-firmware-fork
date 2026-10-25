#!/bin/sh
# json-config-hostc.cgi - 通过 fw_printenv/fw_setenv 读写 hostc 的 uboot 环境变量
#
# GET  ：返回当前配置（server/target/subdomain/enabled）与运行状态为 JSON。
# POST ：保存配置（写入 uboot 环境变量 HOSTC_SERVER/HOSTC_TARGET/
#         HOSTC_SUBDOMAIN/HOSTC_ENABLED）；或处理 action=start|stop|restart
#         服务控制（经 /etc/init.d/S99hostc）。
#
# POST 报文示例（保存配置）：
# {
#   "server": "https://166989.xyz",
#   "target": "127.0.0.1:80",
#   "subdomain": "a1b2c3d4e5f6",
#   "enabled": true
# }
# POST 报文示例（服务控制）：
# { "action": "restart" }

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

DAEMON="/usr/sbin/hostc"
INIT="/etc/init.d/S99hostc"
TMP_FILE=""

# 默认 server / target（按需求固定）
HOSTC_SERVER_DEF="https://166989.xyz"
HOSTC_TARGET_DEF="127.0.0.1:80"

cleanup() {
  [ -n "$TMP_FILE" ] && rm -f "$TMP_FILE"
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

# jct 用于解析 POST 报文，缺失时直接报错而不是静默不保存
command -v jct >/dev/null 2>&1 || \
  json_error 500 "jct is not available" "500 Internal Server Error"

# hostc 支持性检查：hostc 二进制或 init 脚本任一缺失即视为不支持
is_supported() {
  [ -x "$DAEMON" ] || [ -x "$INIT" ]
}

# 运行状态：输出 "true PID" / "false"
get_running() {
  local pids
  pids=$(pidof hostc 2>/dev/null)
  if [ -n "$pids" ]; then
    printf 'true %s' "$(echo "$pids" | cut -d' ' -f1)"
  else
    printf 'false'
  fi
}

# 读取 uboot 环境变量（缺失时回退默认/空）
read_env_val() {
  if command -v fw_printenv >/dev/null 2>&1; then
    fw_printenv -n "$1" 2>/dev/null
  fi
}

# GET - 返回当前配置
if [ "$REQUEST_METHOD" = "GET" ]; then
  if ! is_supported; then
    send_json '{"supported":false}'
  fi

  server=$(read_env_val HOSTC_SERVER)
  target=$(read_env_val HOSTC_TARGET)
  subdomain=$(read_env_val HOSTC_SUBDOMAIN)
  enabled=$(read_env_val HOSTC_ENABLED)

  [ -n "$server" ]    || server="$HOSTC_SERVER_DEF"
  [ -n "$target" ]    || target="$HOSTC_TARGET_DEF"

  # 布尔值归一化
  case "$enabled" in
    1|true|on|enabled|yes) enabled_raw=true ;;
    *)                    enabled_raw=false ;;
  esac

  # 运行状态与服务脚本可用性
  running=$(get_running)
  case "$running" in
    true*) run_raw=true;  pid="${running#true }" ;;
    *)     run_raw=false; pid="" ;;
  esac
  if [ -x "$INIT" ]; then
    svc_raw=true
  else
    svc_raw=false
  fi

  send_json "{\"config\":{\"server\":\"$(json_escape "$server")\",\"target\":\"$(json_escape "$target")\",\"subdomain\":\"$(json_escape "$subdomain")\",\"enabled\":$enabled_raw},\"status\":{\"running\":$run_raw,\"pid\":\"$pid\",\"service\":$svc_raw}}"
fi

# POST - 按白名单修改配置 或 服务控制
if [ "$REQUEST_METHOD" = "POST" ]; then
  if ! is_supported; then
    json_error 501 "hostc 未安装" "501 Not Implemented"
  fi

  # 读取 POST 数据
  if [ -n "$CONTENT_LENGTH" ]; then
    case "$CONTENT_LENGTH" in
      *[!0-9]*) json_error 400 "Invalid Content-Length header" "400 Bad Request" ;;
    esac
    if [ "$CONTENT_LENGTH" -eq 0 ]; then
      json_error 400 "Empty request body" "400 Bad Request"
    fi
    TMP_FILE=$(mktemp /tmp/hostc-req.XXXXXX)
    head -c "$CONTENT_LENGTH" > "$TMP_FILE"
  else
    json_error 400 "未收到 POST 数据"
  fi
  [ -s "$TMP_FILE" ] || json_error 400 "Empty request body" "400 Bad Request"

  # 服务控制：action=start|stop|restart（经 /etc/init.d/S99hostc）
  action=$(jct "$TMP_FILE" get action 2>/dev/null)
  if [ -n "$action" ]; then
    if [ ! -x "$INIT" ]; then
      json_error 501 "hostc 服务脚本未安装" "501 Not Implemented"
    fi
    case "$action" in
      start|stop|restart)
        out=$("$INIT" "$action" 2>&1)
        rc=$?
        [ -n "$out" ] && logger -t hostc-webui "action=$action rc=$rc: $out"
        case "$action" in
          start)   msg="服务启动" ;;
          stop)    msg="服务停止" ;;
          restart) msg="服务重启" ;;
        esac
        if [ "$rc" -eq 0 ]; then
          send_json "{\"success\":true,\"message\":\"${msg}成功\"}"
        else
          send_json "{\"success\":false,\"message\":\"${msg}失败\"}" "500 Internal Server Error"
        fi
        ;;
      *)
        json_error 400 "未知 action"
        ;;
    esac
  fi

  errors=""

  # HOSTC_SERVER
  server=$(jct "$TMP_FILE" get server 2>/dev/null)
  if [ -n "$server" ]; then
    if printf '%s' "$server" | grep -qE '^https?://[A-Za-z0-9._:-]+$'; then
      fw_setenv HOSTC_SERVER "$server" >/dev/null 2>&1 || errors="${errors}server;"
    else
      errors="${errors}server:格式无效;"
    fi
  fi

  # HOSTC_TARGET (host:port)
  target=$(jct "$TMP_FILE" get target 2>/dev/null)
  if [ -n "$target" ]; then
    if printf '%s' "$target" | grep -qE '^[^:]+:[0-9]+$'; then
      port=$(printf '%s' "$target" | sed -E 's/.*://')
      if [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; then
        fw_setenv HOSTC_TARGET "$target" >/dev/null 2>&1 || errors="${errors}target;"
      else
        errors="${errors}target:端口须为1-65535;"
      fi
    else
      errors="${errors}target:格式须为host:port;"
    fi
  fi

  # HOSTC_SUBDOMAIN (12 位小写字母+数字，可留空)
  subdomain=$(jct "$TMP_FILE" get subdomain 2>/dev/null)
  if [ -n "$subdomain" ]; then
    if printf '%s' "$subdomain" | grep -qE '^[a-z0-9]{12}$'; then
      fw_setenv HOSTC_SUBDOMAIN "$subdomain" >/dev/null 2>&1 || errors="${errors}subdomain;"
    else
      errors="${errors}subdomain:须为12位小写字母或数字;"
    fi
  fi

  # HOSTC_ENABLED (true/false)
  enabled=$(jct "$TMP_FILE" get enabled 2>/dev/null)
  if [ -n "$enabled" ]; then
    case "$enabled" in
      true|false)
        fw_setenv HOSTC_ENABLED "$enabled" >/dev/null 2>&1 || errors="${errors}enabled;"
        ;;
      *) errors="${errors}enabled:须为true/false;" ;;
    esac
  fi

  [ -f "$TMP_FILE" ] && rm -f "$TMP_FILE" && TMP_FILE=""

  if [ -n "$errors" ]; then
    send_json "{\"success\":false,\"message\":\"部分参数未保存\",\"errors\":\"$(json_escape "$errors")\"}" "500 Internal Server Error"
  fi
  send_json '{"success":true,"message":"配置已保存"}'
fi

# Method not allowed
send_json '{"error":{"code":405,"message":"Method not allowed"}}' "405 Method Not Allowed"
