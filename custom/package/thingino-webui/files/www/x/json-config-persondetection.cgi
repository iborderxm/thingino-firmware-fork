#!/bin/sh
# json-config-persondetection.cgi - 人形检测配置
#
# GET  ：返回 /etc/persondetection.json 邮件通知配置，并附加 status 字段
#        （prudynt 主进程的运行状态、PID、init 脚本是否存在）。
# POST ：action=get|set 读写通知配置；
#        action=start|stop|restart 经 /etc/init.d/S31prudynt 控制 prudynt
#        主进程（人形检测所属的相机核心服务）。

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

PERSONDETECTION_CONFIG="/etc/persondetection.json"
# prudynt 主进程、其 init 脚本与 PID 文件（/usr/share/common 约定 /run/<name>.pid）
SERVICE_NAME="prudynt"
SERVICE_INIT="/etc/init.d/S31prudynt"
SERVICE_PIDFILE="/run/prudynt.pid"
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

cleanup() {
  [ -n "$REQ_FILE" ] && [ -f "$REQ_FILE" ] && rm -f "$REQ_FILE"
}

trap cleanup EXIT

read_body() {
  REQ_FILE=$(mktemp /tmp/json-config-persondetection.XXXXXX)
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

ensure_persondetection_file() {
  [ -f "$PERSONDETECTION_CONFIG" ] && return
  local old_umask
  old_umask=$(umask)
  umask 077
  echo '{"enable":true,"type":"rename","comment":"视频文件处理方式type(delete删除rename重命名)","from_name":"name","body":"检测到有行人经过","subject":"**人形检测","from_email_num":1,"from_email":[{"enabled":true,"from_username":"test@163.com","from_password":"123123123123","from_address":"test@163.com","send_date":"","554_fail_num":0,"auto_clean":false,"clean_days":1,"clean_folder":"已发送"}],"max_fail_num":10,"smtp_host":"smtp.163.com","smtp_port":465,"imap_host":"imap.163.com","imap_port":993,"trust_cert":true,"use_ssl":true,"to_email":{"to_address":"test@139.com","to_password":"123123123123","to_imap_host":"imap.163.com","to_imap_port":993,"auto_clean":false,"clean_days":7,"clean_folder":"收件箱"}}' >"$PERSONDETECTION_CONFIG"
  umask "$old_umask"
}

load_persondetection_config() {
  ensure_persondetection_file
  cat "$PERSONDETECTION_CONFIG"
}

# prudynt 运行状态：优先检查 PID 文件（/run 与 /var/run 兼容），
# 再回退到 pidof；输出 "true PID" 或 "false"
get_running() {
  local pid="" pf
  for pf in "$SERVICE_PIDFILE" "/var/run/${SERVICE_NAME}.pid"; do
    if [ -f "$pf" ]; then
      pid=$(cat "$pf" 2>/dev/null)
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf 'true %s' "$pid"
        return
      fi
    fi
  done
  pid=$(pidof "$SERVICE_NAME" 2>/dev/null)
  if [ -n "$pid" ]; then
    printf 'true %s' "$(echo "$pid" | cut -d' ' -f1)"
  else
    printf 'false'
  fi
}

# 轮询等待进程到达期望状态：$1=true 等待运行 / false 等待停止，$2=最多尝试次数
# （每次间隔 0.5 秒）。prudynt 重启涉及传感器/ISP 初始化，需要数秒。
wait_for_state() {
  local expect="$1" tries="$2" i running
  i=0
  while [ "$i" -lt "$tries" ]; do
    running="false"
    case "$(get_running)" in
      true*) running="true" ;;
    esac
    [ "$running" = "$expect" ] && return 0
    i=$((i + 1))
    sleep 0.5
  done
  return 1
}

# 服务控制：action = start|stop|restart，经 init 脚本执行
handle_service_action() {
  local action="$1"

  if [ ! -x "$SERVICE_INIT" ]; then
    json_error "501 Not Implemented" "prudynt 服务脚本未安装" "service_not_installed"
  fi

  local msg expect tries
  case "$action" in
    start)   msg="人形检测服务启动"; expect="true";  tries=12 ;;
    stop)    msg="人形检测服务停止"; expect="false"; tries=10 ;;
    restart) msg="人形检测服务重启"; expect="true";  tries=16 ;;
  esac

  # 后台执行 init 脚本（restart 内含停止等待 + 重新拉起，耗时较长），
  # 与 restart-prudynt.cgi 同模式；输出送系统日志，不占用 CGI 输出
  ("$SERVICE_INIT" "$action" 2>&1 | logger -t prudynt-webui -p daemon.info) &

  # init 脚本无论成败都会 exit 0，故以动作后进程的实际存活状态判定成败
  if wait_for_state "$expect" "$tries"; then
    emit_json "" "{\"success\":true,\"message\":\"${msg}成功\"}"
  else
    emit_json "500 Internal Server Error" \
      "{\"success\":false,\"message\":\"${msg}失败，请查看系统日志确认 prudynt 配置是否正确\"}"
  fi
}

apply_persondetection_payload() {
  local payload="$1"
  ensure_persondetection_file

  # 将 payload 写入临时文件供 jct 读取（支持多行 JSON）
  local payload_file
  payload_file=$(mktemp /tmp/persondetection-payload.XXXXXX)
  printf '%s' "$payload" >"$payload_file"

  # 提取各字段值
  local enable type from_name body subject from_email_num
  local smtp_host smtp_port imap_host imap_port trust_cert use_ssl
  local to_address to_password to_imap_host to_imap_port auto_clean clean_days clean_folder

  enable=$(jct "$payload_file" get enable 2>/dev/null)
  type=$(jct "$payload_file" get type 2>/dev/null)
  from_name=$(jct "$payload_file" get from_name 2>/dev/null)
  body=$(jct "$payload_file" get body 2>/dev/null)
  subject=$(jct "$payload_file" get subject 2>/dev/null)
  from_email_num=$(jct "$payload_file" get from_email_num 2>/dev/null)
  smtp_host=$(jct "$payload_file" get smtp_host 2>/dev/null)
  smtp_port=$(jct "$payload_file" get smtp_port 2>/dev/null)
  imap_host=$(jct "$payload_file" get imap_host 2>/dev/null)
  imap_port=$(jct "$payload_file" get imap_port 2>/dev/null)
  trust_cert=$(jct "$payload_file" get trust_cert 2>/dev/null)
  use_ssl=$(jct "$payload_file" get use_ssl 2>/dev/null)
  to_address=$(jct "$payload_file" get to_email.to_address 2>/dev/null)
  to_password=$(jct "$payload_file" get to_email.to_password 2>/dev/null)
  to_imap_host=$(jct "$payload_file" get to_email.to_imap_host 2>/dev/null)
  to_imap_port=$(jct "$payload_file" get to_email.to_imap_port 2>/dev/null)
  auto_clean=$(jct "$payload_file" get to_email.auto_clean 2>/dev/null)
  clean_days=$(jct "$payload_file" get to_email.clean_days 2>/dev/null)
  clean_folder=$(jct "$payload_file" get to_email.clean_folder 2>/dev/null)

  # 更新简单字段：仅当值非空且非 null 时才写入
  [ -n "$enable" ] && [ "$enable" != "null" ] && jct "$PERSONDETECTION_CONFIG" set enable "$enable" >/dev/null 2>&1
  [ -n "$type" ] && [ "$type" != "null" ] && jct "$PERSONDETECTION_CONFIG" set type "$type" >/dev/null 2>&1
  [ -n "$from_name" ] && [ "$from_name" != "null" ] && jct "$PERSONDETECTION_CONFIG" set from_name "$from_name" >/dev/null 2>&1
  [ -n "$body" ] && [ "$body" != "null" ] && jct "$PERSONDETECTION_CONFIG" set body "$body" >/dev/null 2>&1
  [ -n "$subject" ] && [ "$subject" != "null" ] && jct "$PERSONDETECTION_CONFIG" set subject "$subject" >/dev/null 2>&1
  [ -n "$from_email_num" ] && [ "$from_email_num" != "null" ] && jct "$PERSONDETECTION_CONFIG" set from_email_num "$from_email_num" >/dev/null 2>&1
  [ -n "$smtp_host" ] && [ "$smtp_host" != "null" ] && jct "$PERSONDETECTION_CONFIG" set smtp_host "$smtp_host" >/dev/null 2>&1
  [ -n "$smtp_port" ] && [ "$smtp_port" != "null" ] && jct "$PERSONDETECTION_CONFIG" set smtp_port "$smtp_port" >/dev/null 2>&1
  [ -n "$imap_host" ] && [ "$imap_host" != "null" ] && jct "$PERSONDETECTION_CONFIG" set imap_host "$imap_host" >/dev/null 2>&1
  [ -n "$imap_port" ] && [ "$imap_port" != "null" ] && jct "$PERSONDETECTION_CONFIG" set imap_port "$imap_port" >/dev/null 2>&1
  [ -n "$trust_cert" ] && [ "$trust_cert" != "null" ] && jct "$PERSONDETECTION_CONFIG" set trust_cert "$trust_cert" >/dev/null 2>&1
  [ -n "$use_ssl" ] && [ "$use_ssl" != "null" ] && jct "$PERSONDETECTION_CONFIG" set use_ssl "$use_ssl" >/dev/null 2>&1

  # 更新 to_email 嵌套字段（注意：每行必须以换行结束，不能用反斜杠续行，
  # 否则下一行的 [ 会被拼接到上一行命令末尾导致语法错误）
  [ -n "$to_address" ] && [ "$to_address" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.to_address" "$to_address" >/dev/null 2>&1
  [ -n "$to_password" ] && [ "$to_password" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.to_password" "$to_password" >/dev/null 2>&1
  [ -n "$to_imap_host" ] && [ "$to_imap_host" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.to_imap_host" "$to_imap_host" >/dev/null 2>&1
  [ -n "$to_imap_port" ] && [ "$to_imap_port" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.to_imap_port" "$to_imap_port" >/dev/null 2>&1
  [ -n "$auto_clean" ] && [ "$auto_clean" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.auto_clean" "$auto_clean" >/dev/null 2>&1
  [ -n "$clean_days" ] && [ "$clean_days" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.clean_days" "$clean_days" >/dev/null 2>&1
  [ -n "$clean_folder" ] && [ "$clean_folder" != "null" ] && jct "$PERSONDETECTION_CONFIG" set "to_email.clean_folder" "$clean_folder" >/dev/null 2>&1

  # 处理 from_email 数组：仅当 from_email_num > 0 时才更新
  local from_email_count i
  from_email_count=$(jct "$payload_file" get from_email_num 2>/dev/null)

  if [ -n "$from_email_count" ] && [ "$from_email_count" != "null" ] && [ "$from_email_count" -gt 0 ] 2>/dev/null; then
    local from_email_json="["
    i=0
    while [ "$i" -lt "$from_email_count" ]; do
      local enabled_val from_username_val from_password_val from_address_val
      local send_date_val fail_num_val auto_clean_val clean_days_val clean_folder_val

      enabled_val=$(jct "$payload_file" get "from_email.$i.enabled" 2>/dev/null)
      from_username_val=$(jct "$payload_file" get "from_email.$i.from_username" 2>/dev/null)
      from_password_val=$(jct "$payload_file" get "from_email.$i.from_password" 2>/dev/null)
      from_address_val=$(jct "$payload_file" get "from_email.$i.from_address" 2>/dev/null)
      send_date_val=$(jct "$payload_file" get "from_email.$i.send_date" 2>/dev/null)
      fail_num_val=$(jct "$payload_file" get "from_email.$i.554_fail_num" 2>/dev/null)
      auto_clean_val=$(jct "$payload_file" get "from_email.$i.auto_clean" 2>/dev/null)
      clean_days_val=$(jct "$payload_file" get "from_email.$i.clean_days" 2>/dev/null)
      clean_folder_val=$(jct "$payload_file" get "from_email.$i.clean_folder" 2>/dev/null)

      # null 值归一化
      [ "$enabled_val" = "null" ] && enabled_val="true"
      [ "$send_date_val" = "null" ] && send_date_val=""
      [ "$fail_num_val" = "null" ] && fail_num_val="0"
      [ "$auto_clean_val" = "null" ] && auto_clean_val="false"
      [ "$clean_days_val" = "null" ] && clean_days_val="1"
      [ "$clean_folder_val" = "null" ] && clean_folder_val=""

      # 布尔值归一化为 JSON 布尔
      local enabled_json
      if [ "$enabled_val" = "true" ] || [ "$enabled_val" = "1" ]; then
        enabled_json="true"
      else
        enabled_json="false"
      fi
      local auto_clean_json
      if [ "$auto_clean_val" = "true" ] || [ "$auto_clean_val" = "1" ]; then
        auto_clean_json="true"
      else
        auto_clean_json="false"
      fi

      # 字符串字段必须经过 JSON 转义，防止引号/反斜杠破坏 JSON 结构
      local from_username_esc from_password_esc from_address_esc send_date_esc clean_folder_esc
      from_username_esc=$(json_escape "$from_username_val")
      from_password_esc=$(json_escape "$from_password_val")
      from_address_esc=$(json_escape "$from_address_val")
      send_date_esc=$(json_escape "$send_date_val")
      clean_folder_esc=$(json_escape "$clean_folder_val")

      # 数字字段校验：非数字时回退到 0
      case "$fail_num_val" in
        ''|*[!0-9]*) fail_num_val="0" ;;
      esac
      case "$clean_days_val" in
        ''|*[!0-9]*) clean_days_val="1" ;;
      esac

      [ "$i" -gt 0 ] && from_email_json="${from_email_json},"
      from_email_json="${from_email_json}{\"enabled\":${enabled_json},\"from_username\":\"${from_username_esc}\",\"from_password\":\"${from_password_esc}\",\"from_address\":\"${from_address_esc}\",\"send_date\":\"${send_date_esc}\",\"554_fail_num\":${fail_num_val},\"auto_clean\":${auto_clean_json},\"clean_days\":${clean_days_val},\"clean_folder\":\"${clean_folder_esc}\"}"

      i=$((i + 1))
    done
    from_email_json="${from_email_json}]"

    # 将 from_email 数组导入配置文件
    local from_email_only_file
    from_email_only_file=$(mktemp /tmp/persondetection-fromemail.XXXXXX)
    printf '{"from_email":%s}' "$from_email_json" > "$from_email_only_file"
    jct "$PERSONDETECTION_CONFIG" import "$from_email_only_file" >/dev/null 2>&1
    rm -f "$from_email_only_file"
  fi

  rm -f "$payload_file"
}

handle_get() {
  ensure_persondetection_file

  # 运行状态与 init 脚本可用性
  local running run_raw pid svc_raw
  running=$(get_running)
  case "$running" in
    true*) run_raw=true;  pid="${running#true }" ;;
    *)     run_raw=false; pid="" ;;
  esac
  if [ -x "$SERVICE_INIT" ]; then
    svc_raw=true
  else
    svc_raw=false
  fi

  # 将 status 合并进配置“副本”后输出，避免把易变的状态写回真实配置文件
  local status_file resp_file
  status_file=$(mktemp /tmp/persondetection-status.XXXXXX)
  resp_file=$(mktemp /tmp/persondetection-get.XXXXXX)
  printf '{"status":{"running":%s,"pid":"%s","service":%s}}' \
    "$run_raw" "$pid" "$svc_raw" > "$status_file"
  cp "$PERSONDETECTION_CONFIG" "$resp_file"
  jct "$resp_file" import "$status_file" >/dev/null 2>&1
  rm -f "$status_file"

  # emit_json 内部会 exit，故先读出内容并清理临时文件再发送
  local resp_json
  resp_json=$(cat "$resp_file")
  rm -f "$resp_file"
  emit_json "" "$resp_json"
}

handle_post() {
  read_body
  
  local action config_payload
  action=$(jct "$REQ_FILE" get action 2>/dev/null)
  config_payload=$(jct "$REQ_FILE" get config 2>/dev/null)

  if [ -z "$action" ]; then
    json_error "400 Bad Request" "Request missing action." "missing_action"
  fi

  case "$action" in
    get)
      handle_get
      ;;
    set)
      if [ -z "$config_payload" ] || [ "$config_payload" = "null" ]; then
        json_error "400 Bad Request" "Request missing config payload." "missing_payload"
      fi
      apply_persondetection_payload "$config_payload"
      emit_json "" '{"ok":true}'
      ;;
    start|stop|restart)
      handle_service_action "$action"
      ;;
    *)
      json_error "400 Bad Request" "Invalid action." "invalid_action"
      ;;
  esac
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