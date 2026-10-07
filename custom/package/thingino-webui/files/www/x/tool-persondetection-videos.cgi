#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

PRUDYNT_CONFIG="/etc/prudynt.json"
VIDEO_EXTENSIONS="mp4 avi mov mkv webm"

json_escape() {
  input="$1"
  result=$(printf '%s' "$input" | sed \
    -e 's/\\/\\\\/g' \
    -e 's/"/\\"/g' \
    -e "s/\r/\\r/g" \
    -e "s/\n/\\n/g")
  printf '%s' "$result"
}

send_json() {
  status="$2"
  [ -z "$status" ] && status="200 OK"
  printf 'Status: %s\n' "$status"
  printf 'Content-Type: application/json\n'
  printf 'Cache-Control: no-store\n'
  printf 'Pragma: no-cache\n'
  printf '\n'
  printf '%s\n' "$1"
  exit 0
}

json_error() {
  code="$1"
  message="$2"
  status="$3"
  [ -z "$code" ] && code="400"
  [ -z "$status" ] && status="400 Bad Request"
  send_json "{\"error\":{\"code\":$code,\"message\":\"$(json_escape "$message")\"}}" "$status"
}

urldecode() {
  data=$(echo "$1" | sed 's/+/ /g')
  printf '%b' "$(echo "$data" | sed 's/%\([0-9A-F][0-9A-F]\)/\\x\1/g')"
}

get_param() {
  key="$1" qs="$QUERY_STRING"
  [ -z "$qs" ] && return 0

  value=$(echo "$qs" | sed -n "s/^.*${key}=\([^&]*\).*$/\1/p")
  [ -n "$value" ] && urldecode "$value"
  return 0
}

handle_range_response() {
  file="$1"
  if [ ! -f "$file" ]; then
    printf 'Status: 404 Not Found\r\n'
    printf 'Content-Type: text/plain\r\n\r\n'
    printf 'File %s not found' "$file"
    exit 0
  fi

  length start end blocksize
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
  file="$1"
  if [ ! -f "$file" ]; then
    printf 'Status: 404 Not Found\r\n'
    printf 'Content-Type: text/plain\r\n\r\n'
    printf 'File %s not found' "$file"
    exit 0
  fi

  length modified timestamp server
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
  filename="$1"
  ext="${filename##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  case "$ext" in
    mp4|avi|mov|mkv|webm) return 0 ;;
    *) return 1 ;;
  esac
}

get_video_duration() {
  file="$1"
  duration=0
  
  if command -v ffprobe >/dev/null 2>&1; then
    duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    duration=$(printf "%.0f" "$duration" 2>/dev/null || echo "0")
  fi
  
  echo "$duration"
}

list_videos() {
  target="$1"
  
  target=$(echo "$target" | sed 's:/*$::')
  
  [ -d "$target" ] || { return 1; }

  find_output=$(LC_ALL=C find "$target" -type f \( -iname "*.mp4" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.webm" \) ! -iname "*temp*" 2>/dev/null | sort -r)
  
  if [ -z "$find_output" ]; then
    echo "[]"
    return 0
  fi
  
  echo "$find_output" | LC_ALL=C awk -v base="$target" '
BEGIN { 
  count=0
  printf "["
}
{
  path=$0
  name=path
  sub(/^.*\//, "", name)
  
  gsub(/\\/, "\\\\", path)
  gsub(/"/, "\\\"", path)
  gsub(/\r/, "\\r", path)
  gsub(/\n/, "\\n", path)
  
  gsub(/\\/, "\\\\", name)
  gsub(/"/, "\\\"", name)
  gsub(/\r/, "\\r", name)
  gsub(/\n/, "\\n", name)
  
  if (count++) printf(",")
  printf("{\"name\":\"%s\",\"path\":\"%s\",\"size\":0,\"time\":0}", name, path)
}
END {
  printf "]"
}'
}

list_date_folders() {
  target="$1"
  
  target=$(echo "$target" | sed 's:/*$::')
  
  [ -d "$target" ] || { return 1; }

  find_output=$(LC_ALL=C find "$target" -maxdepth 1 -type d -name "[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]" 2>/dev/null | sort -r)
  
  if [ -z "$find_output" ]; then
    echo "[]"
    return 0
  fi
  
  echo "$find_output" | LC_ALL=C awk -v base="$target" '
BEGIN { 
  count=0
  printf "["
}
{
  path=$0
  name=path
  sub(/^.*\//, "", name)
  
  gsub(/\\/, "\\\\", path)
  gsub(/"/, "\\\"", path)
  gsub(/\r/, "\\r", path)
  gsub(/\n/, "\\n", path)
  
  gsub(/\\/, "\\\\", name)
  gsub(/"/, "\\\"", name)
  gsub(/\r/, "\\r", name)
  gsub(/\n/, "\\n", name)
  
  if (count++) printf(",")
  printf("{\"name\":\"%s\",\"path\":\"%s\",\"time\":0}", name, path)
}
END {
  printf "]"
}'
}

get_save_path() {
  save_path=""
  if [ -f "$PRUDYNT_CONFIG" ]; then
    save_path=$(jct "$PRUDYNT_CONFIG" get persondetection.save_path 2>/dev/null)
  fi
  if [ -z "$save_path" ]; then
    save_path="/mnt/mmc/persondetection"
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

if [ ! -d "$save_path" ]; then
  mkdir -p "$save_path" 2>/dev/null
fi

if [ ! -d "$save_path" ]; then
  send_json "{\"save_path\":\"$(json_escape "$save_path")\",\"folders\":[],\"videos\":[]}"
fi

folder_param=$(get_param "folder")

case "$folder_param" in
  "")
    folders_json=$(list_date_folders "$save_path")
    payload=$(printf '{"save_path":"%s","folders":%s,"videos":[]}' "$(json_escape "$save_path")" "$folders_json")
    send_json "$payload"
    ;;
  *)
    [ ! -d "$folder_param" ] && {
      json_error 404 "文件夹不存在"
    }
    videos_json=$(list_videos "$folder_param")
    folder_name=$(basename "$folder_param")
    payload=$(printf '{"save_path":"%s","current_folder":"%s","current_folder_path":"%s","folders":[],"videos":%s}' "$(json_escape "$save_path")" "$(json_escape "$folder_name")" "$(json_escape "$folder_param")" "$videos_json")
    send_json "$payload"
    ;;
esac
