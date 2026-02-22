#!/bin/sh

. /var/www/x/auth.sh
require_auth

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

$1
EOF
  exit 0
}

json_error() {
  code="${1:-400}"
  message="$2"
  send_json "{\"error\":{\"code\":$code,\"message\":\"$(json_escape "$message")\"}}" "${3:-400 Bad Request}"
}

PID=$(pidof opc 2>/dev/null)

if [ -n "$PID" ]; then
  running="true"
  pid="$PID"
  connected="false"
  
  if [ -f "/etc/opc.json" ]; then
    enable=$(jct /etc/opc.json get enable 2>/dev/null)
    server_ip=$(jct /etc/opc.json get server_ip 2>/dev/null)
    server_port=$(jct /etc/opc.json get server_port 2>/dev/null)
    
    if [ -n "$server_ip" ] && [ -n "$server_port" ]; then
      if nc -z -w 2 "$server_ip" "$server_port" 2>/dev/null; then
        connected="true"
      fi
    fi
  fi
else
  running="false"
  pid=""
  connected="false"
fi

if [ "$enable" = "true" ] || [ "$enable" = "1" ]; then
  enabled="true"
else
  enabled="false"
fi

send_json "{\"running\":$running,\"pid\":\"$pid\",\"connected\":$connected,\"enabled\":$enabled}"
