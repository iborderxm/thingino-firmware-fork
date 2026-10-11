#!/bin/sh
# json-config-xfrpc.cgi - 通过 xfrpc-ctl 读写 /etc/xfrpc.toml
#
# GET  ：返回当前配置（服务器参数 + 代理列表 + 运行状态）为 JSON。
# POST ：按白名单修改参数，只能修改已存在的键，不新增、不删除任何参数；
#        或处理 action=start|stop|restart 服务控制（经 /etc/init.d/S99xfrpc）。
#        可修改项：serverAddr、serverPort、enabled（顶层）
#                  proxies.<name>.enabled、proxies.<name>.remotePort
#
# POST 报文示例：
# {
#   "serverAddr": "192.168.31.186",
#   "serverPort": 7000,
#   "enabled": true,
#   "proxies": {
#     "webui": { "enabled": true, "remotePort": 180 }
#   }
# }

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

CTL="/usr/sbin/xfrpc-ctl"
TMP_FILE=""

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
  printf 'Status: %s\n' "$status"
  cat <<EOF
Content-Type: application/json
Cache-Control: no-store
Pragma: no-cache
Connection: close

$1
EOF
  exit 0
}

json_error() {
  code="${1:-400}"
  message="$2"
  send_json "{\"error\":{\"code\":$code,\"message\":\"$(json_escape "$message")\"}}" "${3:-400 Bad Request}"
}

# xfrpc-ctl 可用性检查
require_ctl() {
  if [ ! -x "$CTL" ]; then
    json_error 501 "xfrpc-ctl 未安装" "501 Not Implemented"
  fi
}

# 运行状态：输出 "true PID" / "false"
get_running() {
  local pids
  pids=$(pidof xfrpc 2>/dev/null)
  if [ -n "$pids" ]; then
    printf 'true %s' "$(echo "$pids" | cut -d' ' -f1)"
  else
    printf 'false'
  fi
}

# 代理名白名单校验：仅允许字母数字下划线连字符（防止注入 jct 路径等）
valid_name() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

# 端口校验：1-65535 纯数字
valid_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# GET - 返回当前配置
if [ "$REQUEST_METHOD" = "GET" ]; then
  require_ctl

  server_addr=$($CTL get serverAddr 2>/dev/null)
  server_port=$($CTL get serverPort 2>/dev/null)
  enabled=$($CTL get enabled 2>/dev/null)

  # 布尔值归一化，防止配置里出现其他字面量
  case "$enabled" in
    true) enabled_raw=true ;;
    *)    enabled_raw=false ;;
  esac

  # serverPort 非数字时输出 null
  case "$server_port" in
    ''|*[!0-9]*) port_raw=null ;;
    *)           port_raw="$server_port" ;;
  esac

  # 代理列表：名称经 xfrpc-ctl list 逐行输出，仅保留白名单内的名称
  proxies_json=""
  for name in $($CTL list 2>/dev/null); do
    valid_name "$name" || continue

    p_enabled=$($CTL get "$name" enabled 2>/dev/null)
    p_remote=$($CTL get "$name" remotePort 2>/dev/null)
    p_local=$($CTL get "$name" localPort 2>/dev/null)
    p_type=$($CTL get "$name" type 2>/dev/null)

    case "$p_enabled" in
      true) pe=true ;;
      *)    pe=false ;;
    esac
    case "$p_remote" in
      ''|*[!0-9]*) pr=null ;;
      *)           pr="$p_remote" ;;
    esac
    case "$p_local" in
      ''|*[!0-9]*) pl=null ;;
      *)           pl="$p_local" ;;
    esac

    [ -n "$proxies_json" ] && proxies_json="$proxies_json,"
    proxies_json="$proxies_json{\"name\":\"$(json_escape "$name")\",\"type\":\"$(json_escape "$p_type")\",\"enabled\":$pe,\"localPort\":$pl,\"remotePort\":$pr}"
  done
  [ -n "$proxies_json" ] || proxies_json=''

  # 运行状态与服务脚本可用性
  running=$(get_running)
  case "$running" in
    true*) run_raw=true;  pid="${running#true }" ;;
    *)     run_raw=false; pid="" ;;
  esac
  if [ -x "/etc/init.d/S99xfrpc" ]; then
    svc_raw=true
  else
    svc_raw=false
  fi

  send_json "{\"config\":{\"serverAddr\":\"$(json_escape "$server_addr")\",\"serverPort\":$port_raw,\"enabled\":$enabled_raw},\"proxies\":[$proxies_json],\"status\":{\"running\":$run_raw,\"pid\":\"$pid\",\"service\":$svc_raw}}"
fi

# POST - 按白名单修改配置
if [ "$REQUEST_METHOD" = "POST" ]; then
  require_ctl

  # 读取 POST 数据
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ]; then
    TMP_FILE=$(mktemp /tmp/xfrpc-req.XXXXXX)
    dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null > "$TMP_FILE"
  else
    json_error 400 "未收到 POST 数据"
  fi

  # 服务控制：action=start|stop|restart（经 /etc/init.d/S99xfrpc）
  action=$(jct "$TMP_FILE" get action 2>/dev/null)
  if [ -n "$action" ]; then
    INIT="/etc/init.d/S99xfrpc"
    if [ ! -x "$INIT" ]; then
      json_error 501 "xfrpc 服务脚本未安装" "501 Not Implemented"
    fi
    case "$action" in
      start|stop|restart)
        # 收集 init 脚本输出回传给前端；压平换行便于 JSON 转义
        out=$("$INIT" "$action" 2>&1)
        rc=$?
        out=$(printf '%s' "$out" | tr '\r\n' '  ')
        if [ "$rc" -eq 0 ]; then
          send_json "{\"success\":true,\"message\":\"$(json_escape "$out")\"}"
        else
          send_json "{\"success\":false,\"message\":\"$(json_escape "$out")\"}" "500 Internal Server Error"
        fi
        ;;
      *)
        json_error 400 "未知 action: $action"
        ;;
    esac
  fi

  errors=""

  # 顶层 serverAddr：仅当请求中带该键且通过校验才修改
  server_addr=$(jct "$TMP_FILE" get serverAddr 2>/dev/null)
  if [ -n "$server_addr" ]; then
    if printf '%s' "$server_addr" | grep -qE '^[A-Za-z0-9._-]+$'; then
      $CTL set serverAddr "$server_addr" >/dev/null 2>&1 || errors="${errors}serverAddr;"
    else
      errors="${errors}serverAddr:格式无效;"
    fi
  fi

  # 顶层 serverPort
  server_port=$(jct "$TMP_FILE" get serverPort 2>/dev/null)
  if [ -n "$server_port" ]; then
    if valid_port "$server_port"; then
      $CTL set serverPort "$server_port" >/dev/null 2>&1 || errors="${errors}serverPort;"
    else
      errors="${errors}serverPort:须为1-65535;"
    fi
  fi

  # 顶层 enabled
  enabled=$(jct "$TMP_FILE" get enabled 2>/dev/null)
  if [ -n "$enabled" ]; then
    case "$enabled" in
      true|false)
        $CTL set enabled "$enabled" >/dev/null 2>&1 || errors="${errors}enabled;"
        ;;
      *) errors="${errors}enabled:须为true/false;" ;;
    esac
  fi

  # 代理参数：只处理配置中已存在的代理（xfrpc-ctl list 输出），保证不新增不删除
  for name in $($CTL list 2>/dev/null); do
    valid_name "$name" || continue

    pen=$(jct "$TMP_FILE" get "proxies.$name.enabled" 2>/dev/null)
    if [ -n "$pen" ]; then
      case "$pen" in
        true|false)
          $CTL set "$name" enabled "$pen" >/dev/null 2>&1 || errors="${errors}$name.enabled;"
          ;;
        *) errors="${errors}$name.enabled:须为true/false;" ;;
      esac
    fi

    prem=$(jct "$TMP_FILE" get "proxies.$name.remotePort" 2>/dev/null)
    if [ -n "$prem" ]; then
      if valid_port "$prem"; then
        $CTL set "$name" remotePort "$prem" >/dev/null 2>&1 || errors="${errors}$name.remotePort;"
      else
        errors="${errors}$name.remotePort:须为1-65535;"
      fi
    fi
  done

  [ -f "$TMP_FILE" ] && rm -f "$TMP_FILE" && TMP_FILE=""
  sync

  if [ -n "$errors" ]; then
    send_json "{\"success\":false,\"message\":\"部分参数未保存\",\"errors\":\"$(json_escape "$errors")\"}" "500 Internal Server Error"
  fi
  send_json '{"success":true,"message":"配置已保存"}'
fi

# Method not allowed
send_json '{"error":{"code":405,"message":"Method not allowed"}}' "405 Method Not Allowed"
