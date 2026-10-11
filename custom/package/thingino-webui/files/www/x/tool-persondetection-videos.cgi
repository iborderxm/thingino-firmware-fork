#!/bin/sh

# 人形检测录像视频：列表 / 在线播放 / 下载
#
# 接口约定：
#   GET /x/tool-persondetection-videos.cgi                 -> 日期文件夹列表
#   GET /x/tool-persondetection-videos.cgi?folder=<路径>   -> 指定文件夹内的视频列表
#   GET /x/tool-persondetection-videos.cgi?play=<路径>     -> 在线播放（支持 Range）
#   GET /x/tool-persondetection-videos.cgi?dl=<路径>       -> 下载
#
# 安全说明：folder/play/dl 参数一律限制在 save_path 之下，拒绝 ".." 路径分量，
# 防止目录穿越读取任意系统文件。

# Check authentication
. /var/www/x/auth.sh
require_auth

. /usr/share/common

PRUDYNT_CONFIG="/etc/prudynt.json"
DEFAULT_SAVE_PATH="/mnt/mmc/persondetection"

# ---------- 基础工具 ----------

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

# 去掉目录路径结尾的斜杠，便于统一做前缀比对
normalize_dir() {
  printf '%s' "$1" | sed 's:/*$::'
}

# 路径安全校验：$1 待校验路径，$2 允许的基准目录
# 要求路径严格位于基准目录之下，且不含 ".." 路径分量（编码解码后的 traversal 一并拦截）
is_safe_path() {
  p="$1" base="$2"
  case "$p" in
    "$base"/*) ;;
    *) return 1 ;;
  esac
  case "$p" in
    ..|../*|*/../*|*/..) return 1 ;;
  esac
  return 0
}

get_save_path() {
  save_path=""
  if [ -f "$PRUDYNT_CONFIG" ]; then
    save_path=$(jct "$PRUDYNT_CONFIG" get persondetection.save_path 2>/dev/null)
  fi
  [ -z "$save_path" ] && save_path="$DEFAULT_SAVE_PATH"
  normalize_dir "$save_path"
}

# 按扩展名返回播放用 MIME 类型
video_content_type() {
  ext=$(printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]')
  case "$ext" in
    mp4|m4v) printf 'video/mp4' ;;
    mov)     printf 'video/quicktime' ;;
    avi)     printf 'video/x-msvideo' ;;
    mkv)     printf 'video/x-matroska' ;;
    webm)    printf 'video/webm' ;;
    *)       printf 'application/octet-stream' ;;
  esac
}

# Content-Disposition 用的文件名：去掉引号防止头注入/断行
safe_filename() {
  printf '%s' "$(basename "$1")" | tr -d '"'
}

file_not_found() {
  printf 'Status: 404 Not Found\r\n'
  printf 'Content-Type: text/plain\r\n\r\n'
  printf 'File not found'
  exit 0
}

# 在线播放：无 Range 直接全量输出；有 Range 用 tail|head 按块截取，
# 避免 dd bs=整段长度 一次性分配大缓冲导致低内存设备 OOM。
handle_range_response() {
  file="$1"
  [ -f "$file" ] || file_not_found

  length=$(stat -c%s "$file" 2>/dev/null) || length=0
  ctype=$(video_content_type "$file")
  fname=$(safe_filename "$file")

  range_header=$(env | sed -n 's/^HTTP_RANGE=//p' | tr -d '\r')

  if [ -z "$range_header" ]; then
    printf 'Status: 200 OK\r\n'
    printf 'Content-Type: %s\r\n' "$ctype"
    printf 'Accept-Ranges: bytes\r\n'
    printf 'Content-Length: %s\r\n' "$length"
    printf 'Content-Disposition: inline; filename="%s"\r\n' "$fname"
    printf 'Cache-Control: no-store\r\n'
    printf 'Pragma: no-cache\r\n'
    printf '\r\n'
    cat "$file"
    exit 0
  fi

  # 解析 Range: bytes=start-end | bytes=start- | bytes=-suffix
  spec=${range_header#bytes=}
  first=${spec%%-*}
  rest=${spec#*-}

  if [ -z "$first" ] && [ -n "$rest" ]; then
    # 后缀范围：请求最后 N 字节
    case "$rest" in
      ''|*[!0-9]*) file_not_found ;;
    esac
    start=$((length - rest))
    [ "$start" -lt 0 ] && start=0
    end=$((length - 1))
  else
    case "$first" in
      ''|*[!0-9]*) start=0 ;;
      *) start=$first ;;
    esac
    end=$(printf '%s' "$rest" | tr -cd '0-9')
    [ -z "$end" ] && end=$((length - 1))
    [ "$end" -ge "$length" ] && end=$((length - 1))
  fi

  if [ "$start" -gt "$end" ] || [ "$start" -ge "$length" ]; then
    printf 'Status: 416 Range Not Satisfiable\r\n'
    printf 'Content-Range: bytes */%s\r\n' "$length"
    printf '\r\n'
    exit 0
  fi

  blocksize=$((end - start + 1))

  printf 'Status: 206 Partial Content\r\n'
  printf 'Content-Range: bytes %s-%s/%s\r\n' "$start" "$end" "$length"
  printf 'Content-Length: %s\r\n' "$blocksize"
  printf 'Content-Type: %s\r\n' "$ctype"
  printf 'Accept-Ranges: bytes\r\n'
  printf 'Content-Disposition: inline; filename="%s"\r\n' "$fname"
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf '\r\n'
  tail -c +$((start + 1)) "$file" 2>/dev/null | head -c "$blocksize"
  exit 0
}

# 下载：强制 attachment
handle_download() {
  file="$1"
  [ -f "$file" ] || file_not_found

  length=$(stat -c%s "$file" 2>/dev/null) || length=0
  fname=$(safe_filename "$file")

  printf 'Status: 200 OK\r\n'
  printf 'Content-Type: application/octet-stream\r\n'
  printf 'Content-Length: %s\r\n' "$length"
  printf 'Content-Disposition: attachment; filename="%s"\r\n' "$fname"
  printf 'Cache-Control: no-store\r\n'
  printf 'Pragma: no-cache\r\n'
  printf '\r\n'
  cat "$file"
  exit 0
}

# ---------- 列表 ----------
# 视频扩展名集合（find 表达式，列表与文件夹计数共用同一规则）
# mp4 avi mov mkv webm，忽略包含 temp 的中间文件

# 视频列表：按修改时间倒序，返回真实 size 与 mtime。
# 使用 find -print0 | xargs -0 stat 一次性批量取属性，避免逐文件 fork。
list_videos() {
  target=$(normalize_dir "$1")
  [ -d "$target" ] || { printf '[]'; return 0; }

  LC_ALL=C find "$target" -type f \
    \( -iname "*.mp4" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.webm" \) \
    ! -iname "*temp*" -print0 2>/dev/null \
    | xargs -0 stat -c '%s|%Y|%n' 2>/dev/null \
    | LC_ALL=C sort -t'|' -k2,2nr \
    | LC_ALL=C awk -F'|' '
BEGIN { out = "["; count = 0 }
{
  size = $1 + 0
  mtime = $2 + 0
  path = $3
  # 文件名本身可能含 "|"，第 3 段之后全部拼回路径
  for (i = 4; i <= NF; i++) path = path "|" $i
  name = path
  sub(/^.*\//, "", name)

  gsub(/\\/, "\\\\", path)
  gsub(/"/, "\\\"", path)
  gsub(/\\/, "\\\\", name)
  gsub(/"/, "\\\"", name)

  if (count++) out = out ","
  out = out sprintf("{\"name\":\"%s\",\"path\":\"%s\",\"size\":%d,\"time\":%d}", name, path, size, mtime)
}
END { print (count > 0 ? out "]" : "[]") }'
}

# 日期文件夹列表（save_path 下形如 YYYYMMDD 的一级目录），
# 顺带统计每个文件夹内的视频数量与最近修改时间
list_date_folders() {
  target=$(normalize_dir "$1")
  [ -d "$target" ] || { printf '[]'; return 0; }

  dirs=$(LC_ALL=C find "$target" -maxdepth 1 -type d -name "[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]" 2>/dev/null | LC_ALL=C sort -r)
  [ -n "$dirs" ] || { printf '[]'; return 0; }

  items=$(printf '%s\n' "$dirs" | while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    name=${dir##*/}
    count=$(LC_ALL=C find "$dir" -maxdepth 1 -type f \
      \( -iname "*.mp4" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.mkv" -o -iname "*.webm" \) \
      ! -iname "*temp*" 2>/dev/null | wc -l | tr -d ' ')
    mtime=$(stat -c%Y "$dir" 2>/dev/null) || mtime=0
    printf '{"name":"%s","path":"%s","count":%s,"time":%s}\n' \
      "$(json_escape "$name")" "$(json_escape "$dir")" "${count:-0}" "${mtime:-0}"
  done | LC_ALL=C awk 'NR > 1 { printf "," } { printf "%s", $0 }')

  printf '[%s]' "$items"
}

# ---------- 请求分发 ----------

save_path=$(get_save_path)

play_param=$(get_param "play")
if [ -n "$play_param" ]; then
  is_safe_path "$play_param" "$save_path" || json_error 403 "无效的访问路径" "403 Forbidden"
  handle_range_response "$play_param"
fi

dl_param=$(get_param "dl")
if [ -n "$dl_param" ]; then
  is_safe_path "$dl_param" "$save_path" || json_error 403 "无效的访问路径" "403 Forbidden"
  handle_download "$dl_param"
fi

if [ -n "$REQUEST_METHOD" ] && [ "$REQUEST_METHOD" != "GET" ]; then
  json_error 405 "不允许的方法" "405 Method Not Allowed"
fi

[ -d "$save_path" ] || mkdir -p "$save_path" 2>/dev/null

folder_param=$(get_param "folder")

if [ -z "$folder_param" ]; then
  folders_json=$(list_date_folders "$save_path")
  payload=$(printf '{"save_path":"%s","folders":%s,"videos":[]}' "$(json_escape "$save_path")" "$folders_json")
  send_json "$payload"
fi

is_safe_path "$folder_param" "$save_path" || json_error 403 "无效的访问路径" "403 Forbidden"
[ -d "$folder_param" ] || json_error 404 "文件夹不存在"

videos_json=$(list_videos "$folder_param")
folder_name=$(basename "$folder_param")
payload=$(printf '{"save_path":"%s","current_folder":"%s","current_folder_path":"%s","folders":[],"videos":%s}' \
  "$(json_escape "$save_path")" "$(json_escape "$folder_name")" "$(json_escape "$folder_param")" "$videos_json")
send_json "$payload"
