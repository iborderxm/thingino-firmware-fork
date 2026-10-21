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

build_payload() {
  cat <<'EOF'
{
  "actions": [
    {
      "id": "reboot",
      "title": "Reboot camera",
      "description_html": "Reboot the camera to apply new settings. This also clears temporary data in memory-backed partitions such as /tmp.",
      "cta": {
        "type": "form",
        "method": "POST",
        "action": "/x/reboot.cgi",
        "button": "Reboot camera",
        "variant": "danger",
        "fields": [
          {"name": "action", "value": "reboot"}
        ]
      }
    },
    {
      "id": "wipeoverlay",
      "title": "Wipe overlay",
      "description_html": "Remove all <a href=\"/info-overlay.html\">files stored in the overlay partition</a>. Most customizations will be lost.",
      "cta": {
        "type": "link",
        "href": "/firmware-reset.html?action=wipeoverlay",
        "text": "Wipe overlay",
        "variant": "danger"
      }
    },
    {
      "id": "fullreset",
      "title": "Reset firmware",
      "description_html": "Restore firmware to its factory state. All settings and overlay files will be removed.",
      "cta": {
        "type": "link",
        "href": "/firmware-reset.html?action=fullreset",
        "text": "Reset firmware",
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
