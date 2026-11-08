#!/bin/sh
# json-config-nas.cgi - NAS(NFS) 共享配置
#
# GET  ：返回 /etc/thingino.json 的 nfs_share，以及 /proc/mounts、df -h 中的
#        挂载状态与容量参数({"nfs_share":"...","mount":{...}})
# POST ：按 {"server_ip":"...","remote_path":"..."} 拼成 <server_ip>:<remote_path>
#        并执行 jct /etc/thingino.json set nfs_share "<server_ip>:<remote_path>"；
#        保存后检查 /mnt/nfs 的挂载源是否与配置一致，否则重启 S43mounts。
#        配置损坏时先备份为 <config>.bad 再写入，响应带 config_repaired。

# Check authentication
. /var/www/x/auth.sh
require_auth

# 以下路径仅用于测试时替换，生产默认值见右侧
CONFIG_FILE="${NAS_CONFIG_FILE:-/etc/thingino.json}"
MOUNTS_FILE="${NAS_MOUNTS_FILE:-/proc/mounts}"
MOUNT_POINT="${NAS_MOUNT_POINT:-/mnt/nfs}"
MOUNTS_INIT="${NAS_MOUNTS_INIT:-/etc/init.d/S43mounts}"
# checknfs 每分钟把 2049 端口探测结果写到这里；仅用于测试时替换
PROBE_FILE="${NAS_PROBE_FILE:-/tmp/nfs}"
REQ_FILE=""

cleanup() {
  [ -n "$REQ_FILE" ] && [ -f "$REQ_FILE" ] && rm -f "$REQ_FILE"
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
  value="$1"
  # 先去掉 JSON 字符串的首尾引号(含被转义的 \" 形式)，再判断是否为 null
  value=$(printf '%s' "$value" | sed -e 's/^"//' -e 's/"$//' -e 's/^\\"//' -e 's/\\"$//')
  case "$value" in
    ""|null|NULL)
      printf ''
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

ensure_config() {
  # 空文件同样视为损坏；截断写入不会改变已有文件的权限
  if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
    umask 077
    printf '{}\n' >"$CONFIG_FILE"
  fi
}

# 检测配置是否损坏：jct 对空/非法 JSON 会在 stderr 打印解析错误，
# 合法但缺键时只会提示 Key not found。
config_is_broken() {
  [ -s "$CONFIG_FILE" ] || return 0
  probe=$(jct "$CONFIG_FILE" get __nas_config_probe__ 2>&1 >/dev/null || :)
  case "$probe" in
    *"is empty"*|*"Failed to parse JSON"*|*"Extra characters"*) return 0 ;;
  esac
  return 1
}

read_current_share() {
  ensure_config
  share=$(jct "$CONFIG_FILE" get nfs_share 2>/dev/null || :)
  strip_json_string "$share"
}

read_body() {
  REQ_FILE=$(mktemp /tmp/nas-req.XXXXXX)
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

# 白名单校验：拼接值会写入 JSON 并交给挂载脚本，拒绝空白、引号、
# shell 元字符及换行，避免配置被污染。
valid_server_ip() {
  [ ${#1} -le 253 ] || return 1
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+$'
}

valid_remote_path() {
  [ ${#1} -le 256 ] || return 1
  case "$1" in
    *'/../'*|*'/..') return 1 ;;
  esac
  printf '%s' "$1" | grep -qE '^/[A-Za-z0-9._/-]*$'
}

# /proc/mounts 中挂载点对应的源(形如 192.168.1.10:/volume1/video)，未挂载则为空
read_mounted_share() {
  awk -v mp="$MOUNT_POINT" '$2 == mp {print $1; exit}' "$MOUNTS_FILE" 2>/dev/null
}

# 分别比较已挂载源的服务端 IP、远程目录与配置中的两个要素
share_matches() {
  current="$1"
  target="$2"
  [ -n "$current" ] || return 1
  case "$current" in
    *:*) ;;
    *) return 1 ;;
  esac
  [ "${current%%:*}" = "${target%%:*}" ] || return 1
  [ "${current#*:}" = "${target#*:}" ]
}

# df -h 中挂载点的容量信息：容量 已用 可用 使用率，取不到则返回空。
# NFS 设备名过长时 df 会把源单独折行，故按最后一列匹配挂载点并从右往左取 4 列。
read_mount_usage() {
  df_out=""
  if command -v timeout >/dev/null 2>&1; then
    df_out=$(timeout 5 df -h 2>/dev/null)
  else
    df_out=$(df -h 2>/dev/null)
  fi
  printf '%s\n' "$df_out" | awk -v mp="$MOUNT_POINT" \
    '$NF == mp && NF >= 5 {printf "%s %s %s %s\n", $(NF-4), $(NF-3), $(NF-2), $(NF-1); exit}'
}

# 读取 checknfs 的后台探测结果：0 正常 / 1 异常；文件缺失或内容非法为 null(未知)。
# 只读 /tmp 文件，不触碰 /mnt/nfs，服务端宕机时不会挂起。
read_server_alive() {
  probe=$(cat "$PROBE_FILE" 2>/dev/null || :)
  case "$probe" in
    0) printf 'true' ;;
    1) printf 'false' ;;
    *) printf 'null' ;;
  esac
}

# 页面顶部展示用：配置值、实际挂载源及其服务端/目录、挂载点、服务端探测与 df 容量参数
read_mount_status() {
  target="$1"
  # 如果server_ip为空，则不进行挂载，直接返回
  if [ -z "$target" ]; then
    printf '{"mounted":false,"matched":false,"server_alive":null,"source":"","server_ip":"","remote_path":"","mount_point":"","nfs_share":"","size":"","used":"","available":"","use_percent":""}'
    return
  fi
  alive=$(read_server_alive)
  current=$(read_mounted_share)
  # 服务端已判为不可达时跳过 df：df 会 stat 挂载点并卡到 5 秒超时
  usage=""
  if [ "$alive" != "false" ]; then
    usage=$(read_mount_usage)
  fi
  size=""; used=""; available=""; use_percent=""
  if [ -n "$usage" ]; then
    IFS=' ' read -r size used available use_percent <<EOF
$usage
EOF
  fi

  if [ -n "$current" ]; then
    mounted=true
    case "$current" in
      *:*) cur_ip=${current%%:*}; cur_path=${current#*:} ;;
      *) cur_ip="$current"; cur_path="" ;;
    esac
  else
    mounted=false
    cur_ip=""
    cur_path=""
  fi
  if share_matches "$current" "$target"; then matched=true; else matched=false; fi

  printf '{"mounted":%s,"matched":%s,"server_alive":%s,"source":"%s","server_ip":"%s","remote_path":"%s","mount_point":"%s","nfs_share":"%s","size":"%s","used":"%s","available":"%s","use_percent":"%s"}' \
    "$mounted" "$matched" "$alive" "$(json_escape "$current")" \
    "$(json_escape "$cur_ip")" "$(json_escape "$cur_path")" \
    "$(json_escape "$MOUNT_POINT")" "$(json_escape "$target")" \
    "$(json_escape "$size")" "$(json_escape "$used")" \
    "$(json_escape "$available")" "$(json_escape "$use_percent")"
}

# 保存后检查挂载状态，未挂载或不一致时重启挂载服务。
# 本函数经 $(...) 在子 shell 执行，只输出 JSON 片段，不调用 send_json/json_error。
check_mount_and_restart() {
  target="$1"
  current=$(read_mounted_share)
  if share_matches "$current" "$target"; then
    printf '{"mounted":true,"matched":true,"restart":false,"restart_ok":true,"message":"NFS 已挂载，服务端与共享目录均与配置一致"}'
    return
  fi

  if [ -n "$current" ]; then
    was_mounted=true
    reason="挂载的服务端或共享目录与配置不一致"
  else
    was_mounted=false
    reason="NFS 尚未挂载"
  fi

  if [ ! -x "$MOUNTS_INIT" ]; then
    printf '{"mounted":%s,"matched":false,"restart":true,"restart_ok":false,"message":"%s，但挂载服务脚本 %s 不存在"}' \
      "$was_mounted" "$reason" "$(json_escape "$MOUNTS_INIT")"
    return
  fi

  # NFS 服务端不可达时 mount 可能长时间阻塞，有 timeout 则限制在 20 秒内
  if command -v timeout >/dev/null 2>&1; then
    out=$(timeout 20 "$MOUNTS_INIT" restart 2>&1)
    rc=$?
  else
    out=$("$MOUNTS_INIT" restart 2>&1)
    rc=$?
  fi
  # 压平多行输出、去掉 echo -c 颜色码与控制字符，避免破坏 JSON 响应
  out=$(printf '%s' "$out" | tr '\n\r\t' '   ' | tr -d '\000-\010\013\014\016-\037\177' | sed 's/\[[0-9;]*[A-Za-z]//g' | cut -c1-160)
  [ -n "$out" ] || out="挂载服务未返回输出"

  final=$(read_mounted_share)
  if share_matches "$final" "$target"; then
    printf '{"mounted":true,"matched":true,"restart":true,"restart_ok":true,"message":"%s，已重启挂载服务"}' "$reason"
    return
  fi

  if [ "$rc" -eq 0 ]; then
    printf '{"mounted":%s,"matched":false,"restart":true,"restart_ok":false,"message":"已重启挂载服务，但 %s 未挂载到配置目标：%s"}' \
      "$was_mounted" "$(json_escape "$MOUNT_POINT")" "$(json_escape "$out")"
  else
    printf '{"mounted":%s,"matched":false,"restart":true,"restart_ok":false,"message":"重启挂载服务失败：%s"}' \
      "$was_mounted" "$(json_escape "$out")"
  fi
}

handle_get() {
  share=$(read_current_share)
  mount_status=$(read_mount_status "$share")
  send_json "{\"nfs_share\":\"$(json_escape "$share")\",\"mount\":$mount_status}"
}

handle_post() {
  read_body
  server_ip=$(jct "$REQ_FILE" get server_ip 2>/dev/null || :)
  remote_path=$(jct "$REQ_FILE" get remote_path 2>/dev/null || :)
  server_ip=$(strip_json_string "$server_ip")
  remote_path=$(strip_json_string "$remote_path")

  if [ -z "$server_ip" ] || [ -z "$remote_path" ]; then
    json_error 422 "server_ip 和 remote_path 均不能为空" "422 Unprocessable Entity"
  fi
  if ! valid_server_ip "$server_ip"; then
    json_error 422 "server_ip 格式无效，仅支持 IPv4 地址或域名" "422 Unprocessable Entity"
  fi
  if ! valid_remote_path "$remote_path"; then
    json_error 422 "remote_path 格式无效，须以 / 开头且不含空格、引号或特殊字符" "422 Unprocessable Entity"
  fi

  # 配置损坏时 jct set 会静默重建整个文件，先备份现场以免丢失其他配置项
  CONFIG_REPAIRED=false
  CONFIG_BACKUP=""
  if config_is_broken; then
    CONFIG_BACKUP="${CONFIG_FILE}.bad"
    if cp -f "$CONFIG_FILE" "$CONFIG_BACKUP" 2>/dev/null; then
      CONFIG_REPAIRED=true
    else
      CONFIG_BACKUP=""
    fi
  fi

  ensure_config
  nfs_share="${server_ip}:${remote_path}"
  if ! jct "$CONFIG_FILE" set nfs_share "$nfs_share" >/dev/null 2>&1; then
    json_error 500 "写入 nfs_share 失败(配置可能不可写)" "500 Internal Server Error"
  fi

  # 回读确认，避免 jct 写入未落地却向前端报告成功
  saved_share=$(read_current_share)
  if [ "$saved_share" != "$nfs_share" ]; then
    json_error 500 "nfs_share 回读不一致" "500 Internal Server Error"
  fi

  check_state=$(check_mount_and_restart "$saved_share")
  mount_status=$(read_mount_status "$saved_share")
  send_json "{\"status\":\"ok\",\"nfs_share\":\"$(json_escape "$saved_share")\",\"mount\":$mount_status,\"check\":$check_state,\"config_repaired\":$CONFIG_REPAIRED,\"config_backup\":\"$(json_escape "$CONFIG_BACKUP")\"}"
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
