#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

PERSONDETECTION_CONFIG="/etc/persondetection.json"
REQ_FILE=""

emit_json() {
  local status="$1"
  shift
  [ -n "$status" ] && printf 'Status: %s\n' "$status"
  cat <<EOF
Content-Type: application/json
Cache-Control: no-store
Pragma: no-cache

$1
EOF
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
  if [ -n "$CONTENT_LENGTH" ]; then
    dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null >"$REQ_FILE"
  else
    cat >"$REQ_FILE"
  fi
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
  local config
  config=$(load_persondetection_config)
  emit_json "" "$config"
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