#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

config_file=/etc/telegrambot.json
if [ "$REQUEST_METHOD" = "POST" ]; then
	cl=${CONTENT_LENGTH:-0}
	case "$cl" in
		''|*[!0-9]*) cl=0 ;;
	esac
	if [ "$cl" -gt 0 ]; then
		# head -c 为缓冲读取；dd bs=1 每字节一次系统调用，KB 级报文会明显变慢
		json=$(head -c "$cl")
		[ -n "$json" ] && printf '%s' "$json" > $config_file
	fi
fi

printf 'Content-Type: application/json\r\n'
printf 'Cache-Control: no-store\r\n'
printf 'Connection: close\r\n'
printf '\r\n'
cat $config_file

