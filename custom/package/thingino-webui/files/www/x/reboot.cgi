#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

umount -a -t nfs -l
sleep 3
printf 'HTTP/1.1 302 Moved Temporarily\r\n'
printf 'Date: %s\r\n' "$(TZ=GMT0 date +'%a, %d %b %Y %T %Z')"
printf 'Server: %s\r\n' "$SERVER_SOFTWARE"
printf 'Content-type: text/html; charset=UTF-8\r\n'
printf 'Cache-Control: no-store\r\n'
printf 'Pragma: no-cache\r\n'
printf 'Connection: close\r\n'
printf 'Location: /wait.html\r\n'
printf 'Status: 302 Moved Temporarily\r\n'
printf '\r\n'
printf "I'll be back\n"
sleep 1
reboot -f
