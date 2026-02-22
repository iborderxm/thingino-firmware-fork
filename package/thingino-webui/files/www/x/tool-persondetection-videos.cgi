#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

PRUDYNT_CONFIG="/etc/prudynt.json"
VIDEO_EXTENSIONS="mp4 avi mov mkv webm"

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

urldecode() {
  local data="${1//+/ }"
  printf '%b' "${data//%/\\x}"
}

get_param() {
  local key="$1" qs="$QUERY_STRING" pair value
  [ -z "$qs" ] && return 1

  local oldifs="$IFS"
  IFS='&'
  for pair in $qs; do
    IFS="$oldifs"
    case "$pair" in
      "$key"=*)
        value="${pair#*=}"
        urldecode "$value"
        IFS="$oldifs"
        return 0
        ;;
      "$key")
        printf ''
        IFS="$oldifs"
        return 0
        ;;
    esac
    IFS='&'
  done
  IFS="$oldifs"
  return 1
}

handle_range_response() {
  local file="$1"
  if [ ! -f "$file" ]; then
    printf 'Status: 404 Not Found\r\n'
    printf 'Content-Type: text/plain\r\n\r\n'
    printf 'File %s not found' "$file"
    exit 0
  fi

  local length start end blocksize
  length=$(stat -c%s "$file") || length=0

  if ! env | grep -q '^HTTP_RANGE'; then
    printf 'Status: 200 OK\r\n'
    printf 'Content-Type: video/mp4\r\n'
    printf 'Accept-Ranges: bytes\r\n'
    printf 'Content-Length: %s\r\n' "$length"
    printf 'Content-Disposition: attachment; filename=%s\r\n' "$(basename "$file")"
    printf 'Cache-Control: no-store\r\n'
    printf 'Pragma: no-cache\r\n'
    printf '\r\n'
    cat "$file"
    exit 0
  fi

  start=$(env | awk -F'[=-]' '/^HTTP_RANGE=/{print $3}')
  [ -z "$start" ] && start=0

  if [ "$start" -gt "$length" ]; then
    printf 'HTTP/1.1 416 Requested Range Not Satisfiable\r\n'
    printf 'Content-Range: bytes */%s\r\n' "$length"
    printf '\r\n'
    exit 0
  fi

  end=$(env | awk -F'[=-]' '/^HTTP_RANGE=/{print $4}')
  [ -z "$end" ] && end=$((length - 1))
  blocksize=$((end - start + 1))

  printf 'Status: 206 Partial Content\r\n'
  printf 'Content-Range: bytes %s-%s/%s\r\n' "$start" "$end" "$length"
  printf 'Content-Length: %s\r\n' "$blocksize"
  printf 'Content-Type: video/mp4\r\n'
  printf 'Accept-Ranges: bytes\r\n'
  printf 'Content-Disposition: attachment; filename=%s\r\n' "$(basename "$file")"
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf '\r\n'
  dd if="$file" skip=$start bs=$blocksize count=1 iflag=skip_bytes 2>/dev/null
  exit 0
}

handle_download() {
  local file="$1"
  if [ ! -f "$file" ]; then
    printf 'Status: 404 Not Found\r\n'
    printf 'Content-Type: text/plain\r\n\r\n'
    printf 'File %s not found' "$file"
    exit 0
  fi

  local length modified timestamp server
  length=$(stat -c%s "$file") || length=0
  modified=$(stat -c%Y "$file") || modified=0
  timestamp=$(TZ=GMT0 date +"%a, %d %b %Y %T %Z" --date="@$modified")
  server="${SERVER_SOFTWARE:-thingino}"

  printf 'Status: 200 OK\r\n'
  printf 'Date: %s\r\n' "$timestamp"
  printf 'Server: %s\r\n' "$server"
  printf 'Content-Type: application/octet-stream\r\n'
  printf 'Content-Length: %s\r\n' "$length"
  printf 'Content-Disposition: attachment; filename=%s\r\n' "$(basename "$file")"
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf '\r\n'
  cat "$file"
  exit 0
}

is_video_file() {
  local filename="$1"
  local ext="${filename##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  case "$ext" in
    mp4|avi|mov|mkv|webm) return 0 ;;
    *) return 1 ;;
  esac
}

get_video_duration() {
  local file="$1"
  local duration=0
  
  if command -v ffprobe >/dev/null 2>&1; then
    duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    duration=$(printf "%.0f" "$duration" 2>/dev/null || echo "0")
  fi
  
  echo "$duration"
}

list_videos() {
  local target="$1" json
  [ -d "$target" ] || return 1

  json=$(LC_ALL=C find "$target" -type f \( -iname "*.mp4" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.webm" \) -printf '%p|%s|%T@\n' 2>/dev/null | sort -t'|' -k3 -rn | awk -v base="$target" '
BEGIN { count=0 }
function escape(str) {
  gsub(/\\/, "\\\\", str)
  gsub(/"/, "\\\"", str)
  gsub(/\r/, "\\r", str)
  gsub(/\n/, "\\n", str)
  return str
}
{
  split($0, parts, "|")
  path=parts[1]
  size=parts[2]
  timestamp=parts[3]
  
  name=path
  sub(/^.*\//, "", name)
  
  path=escape(path)
  name=escape(name)
  
  if (count++) printf(",")
  printf("{\"name\":\"%s\",\"path\":\"%s\",\"size\":%s,\"time\":%s}", name, path, size, timestamp)
}
') || return 1

  printf '[%s]' "$json"
}

get_save_path() {
  local save_path=""
  if [ -f "$PRUDYNT_CONFIG" ]; then
    save_path=$(jct "$PRUDYNT_CONFIG" get persondetection.save_path 2>/dev/null)
  fi
  echo "$save_path"
}

play_param=$(get_param "play")
if [ -n "$play_param" ]; then
  handle_range_response "$play_param"
fi

dl_param=$(get_param "dl")
if [ -n "$dl_param" ]; then
  handle_download "$dl_param"
fi

if [ -n "$REQUEST_METHOD" ] && [ "$REQUEST_METHOD" != "GET" ]; then
  json_error 405 "不允许的方法" "405 Method Not Allowed"
fi

save_path=$(get_save_path)

if [ -z "$save_path" ] || [ ! -d "$save_path" ]; then
  send_json "{\"save_path\":\"$(json_escape "$save_path")\",\"videos\":[]}"
fi

videos_json=$(list_videos "$save_path") || json_error 500 "无法列出视频"

payload=$(cat <<EOF
{
  "save_path": "$(json_escape "$save_path")",
  "videos": $videos_json
}
EOF
)

send_json "$payload"
