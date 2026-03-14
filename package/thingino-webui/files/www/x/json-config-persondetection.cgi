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
  echo '{"enable":false,"type":"rename","from_name":"name","body":"检测到有行人经过","subject":"**人形检测","from_email_num":1,"from_email":[{"enabled":true,"username":"","password":"","from_address":"","send_date":"","554_fail_num":0}],"max_fail_num":10,"host":"smtp.163.com","port":465,"trust_cert":true,"use_ssl":true,"to_address":"","to_name":""}' >"$PERSONDETECTION_CONFIG"
  umask "$old_umask"
}

load_persondetection_config() {
  ensure_persondetection_file
  cat "$PERSONDETECTION_CONFIG"
}

apply_persondetection_payload() {
  local payload="$1"
  ensure_persondetection_file
  
  # Write payload to temp file for jct to read (handles multi-line JSON)
  local payload_file
  payload_file=$(mktemp /tmp/payload.XXXXXX)
  printf '%s' "$payload" >"$payload_file"
  
  # Extract values from payload and update config file using jct set
  local enable type from_name body subject from_email_num host port trust_cert use_ssl to_address to_name
  
  enable=$(jct "$payload_file" get enable 2>/dev/null)
  type=$(jct "$payload_file" get type 2>/dev/null)
  from_name=$(jct "$payload_file" get from_name 2>/dev/null)
  body=$(jct "$payload_file" get body 2>/dev/null)
  subject=$(jct "$payload_file" get subject 2>/dev/null)
  from_email_num=$(jct "$payload_file" get from_email_num 2>/dev/null)
  host=$(jct "$payload_file" get host 2>/dev/null)
  port=$(jct "$payload_file" get port 2>/dev/null)
  trust_cert=$(jct "$payload_file" get trust_cert 2>/dev/null)
  use_ssl=$(jct "$payload_file" get use_ssl 2>/dev/null)
  to_address=$(jct "$payload_file" get to_address 2>/dev/null)
  to_name=$(jct "$payload_file" get to_name 2>/dev/null)
  
  # Update simple fields - check if value is not null
  [ -n "$enable" ] && [ "$enable" != "null" ] && jct "$PERSONDETECTION_CONFIG" set enable "$enable" >/dev/null 2>&1
  [ -n "$type" ] && [ "$type" != "null" ] && jct "$PERSONDETECTION_CONFIG" set type "$type" >/dev/null 2>&1
  [ -n "$from_name" ] && [ "$from_name" != "null" ] && jct "$PERSONDETECTION_CONFIG" set from_name "$from_name" >/dev/null 2>&1
  [ -n "$body" ] && [ "$body" != "null" ] && jct "$PERSONDETECTION_CONFIG" set body "$body" >/dev/null 2>&1
  [ -n "$subject" ] && [ "$subject" != "null" ] && jct "$PERSONDETECTION_CONFIG" set subject "$subject" >/dev/null 2>&1
  [ -n "$from_email_num" ] && [ "$from_email_num" != "null" ] && jct "$PERSONDETECTION_CONFIG" set from_email_num "$from_email_num" >/dev/null 2>&1
  [ -n "$host" ] && [ "$host" != "null" ] && jct "$PERSONDETECTION_CONFIG" set host "$host" >/dev/null 2>&1
  [ -n "$port" ] && [ "$port" != "null" ] && jct "$PERSONDETECTION_CONFIG" set port "$port" >/dev/null 2>&1
  [ -n "$trust_cert" ] && [ "$trust_cert" != "null" ] && jct "$PERSONDETECTION_CONFIG" set trust_cert "$trust_cert" >/dev/null 2>&1
  [ -n "$use_ssl" ] && [ "$use_ssl" != "null" ] && jct "$PERSONDETECTION_CONFIG" set use_ssl "$use_ssl" >/dev/null 2>&1
  [ -n "$to_address" ] && [ "$to_address" != "null" ] && jct "$PERSONDETECTION_CONFIG" set to_address "$to_address" >/dev/null 2>&1
  [ -n "$to_name" ] && [ "$to_name" != "null" ] && jct "$PERSONDETECTION_CONFIG" set to_name "$to_name" >/dev/null 2>&1
  
  # Handle from_email array - build complete array JSON and set it
  local from_email_count i
  
  # Get the array count from from_email_num
  from_email_count=$(jct "$payload_file" get from_email_num 2>/dev/null)
  
  if [ -n "$from_email_count" ] && [ "$from_email_count" != "null" ] && [ "$from_email_count" -gt 0 ] 2>/dev/null; then
    # Build the from_email array JSON manually
    local from_email_json="["
    i=0
    while [ "$i" -lt "$from_email_count" ]; do
      local enabled_val username_val password_val from_address_val send_date_val fail_num_val
      enabled_val=$(jct "$payload_file" get "from_email.$i.enabled" 2>/dev/null)
      username_val=$(jct "$payload_file" get "from_email.$i.username" 2>/dev/null)
      password_val=$(jct "$payload_file" get "from_email.$i.password" 2>/dev/null)
      from_address_val=$(jct "$payload_file" get "from_email.$i.from_address" 2>/dev/null)
      send_date_val=$(jct "$payload_file" get "from_email.$i.send_date" 2>/dev/null)
      fail_num_val=$(jct "$payload_file" get "from_email.$i.554_fail_num" 2>/dev/null)
      
      # Handle null values
      [ "$enabled_val" = "null" ] && enabled_val="true"
      [ "$send_date_val" = "null" ] && send_date_val=""
      [ "$fail_num_val" = "null" ] && fail_num_val="0"
      
      # Build JSON object for this array element
      if [ "$i" -gt 0 ]; then
        from_email_json="${from_email_json},"
      fi
      
      # Convert boolean to JSON boolean
      local enabled_json
      if [ "$enabled_val" = "true" ] || [ "$enabled_val" = "1" ]; then
        enabled_json="true"
      else
        enabled_json="false"
      fi
      
      # Build the object
      from_email_json="${from_email_json}{\"enabled\":$enabled_json,\"username\":\"$username_val\",\"password\":\"$password_val\",\"from_address\":\"$from_address_val\",\"send_date\":\"$send_date_val\",\"554_fail_num\":$fail_num_val}"
      
      i=$((i + 1))
    done
    from_email_json="${from_email_json}]"
    
    # Create a temp file with only the from_email array
    local from_email_only_file
    from_email_only_file=$(mktemp /tmp/from_email_only.XXXXXX)
    echo "{\"from_email\":$from_email_json}" > "$from_email_only_file"
    
    # Use jct import to merge the from_email array into the config
    jct "$PERSONDETECTION_CONFIG" import "$from_email_only_file" >/dev/null 2>&1
    
    rm -f "$from_email_only_file"
  fi
  
  # Clean up payload temp file
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