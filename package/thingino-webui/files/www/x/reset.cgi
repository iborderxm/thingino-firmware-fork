#!/bin/sh

# Check authentication
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

build_payload() {
  cat <<'EOF'
{
  "actions": [
    {
      "id": "reboot",
      "title": "重新启动摄像机",
      "description_html": "重新启动摄像机以应用新设置。这也会清除内存支持分区（如 /tmp）中的临时数据。",
      "cta": {
        "type": "form",
        "method": "POST",
        "action": "/x/reboot.cgi",
        "button": "重新启动摄像机",
        "variant": "danger",
        "fields": [
          {"name": "action", "value": "reboot"}
        ]
      }
    },
    {
      "id": "wipeoverlay",
      "title": "清除覆盖分区",
      "description_html": "删除所有<a href=\"/info-overlay.html\">存储在覆盖分区中的文件</a>。大多数自定义内容将丢失。",
      "cta": {
        "type": "link",
        "href": "/firmware-reset.html?action=wipeoverlay",
        "text": "清除覆盖分区",
        "variant": "danger"
      }
    },
    {
      "id": "fullreset",
      "title": "重置固件",
      "description_html": "将固件恢复到出厂状态。所有设置和覆盖文件将被删除。",
      "cta": {
        "type": "link",
        "href": "/firmware-reset.html?action=fullreset",
        "text": "重置固件",
        "variant": "danger"
      }
    }
  ]
}
EOF
}

handle_get() {
  send_json "$(build_payload)"
}

case "$REQUEST_METHOD" in
  GET|"")
    handle_get
    ;;
  *)
    json_error 405 "Method not allowed" "405 Method Not Allowed"
    ;;
esac
