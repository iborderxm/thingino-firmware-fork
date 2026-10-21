#!/bin/sh

# Check authentication
. /var/www/x/auth.sh
require_auth

json_encode() {
	echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g' | awk '{printf "%s\\n", $0}' | sed '$ s/\\n$//'
}

json_response() {
	printf 'Content-type: application/json; charset=UTF-8\r\n'
	printf 'Cache-Control: no-store\r\n'
	printf 'Pragma: no-cache\r\n'
	printf 'Connection: close\r\n'
	printf '\r\n'
	printf '%s\n' "$1"
}

scan_networks() {
	# Check if wpa_cli is available
	if ! command -v wpa_cli >/dev/null 2>&1; then
		echo '{"error": "wpa_cli not available"}'
		return
	fi

	# Check if scan is already in progress
	SCAN_LOCK="/tmp/wpa_scan.lock"
	SCAN_WAIT=0
	SHOULD_SCAN=1

	# Wait up to 8 seconds for ongoing scan to complete
	while [ -f "$SCAN_LOCK" ] && [ $SCAN_WAIT -lt 8 ]; do
		# Check if lock is stale (older than 15 seconds)
		LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$SCAN_LOCK" 2>/dev/null || echo 0) ))
		if [ $LOCK_AGE -gt 15 ]; then
			rm -f "$SCAN_LOCK"
			break
		fi
		sleep 1
		SCAN_WAIT=$((SCAN_WAIT + 1))
	done

	# If still locked after waiting, use cached results
	if [ -f "$SCAN_LOCK" ]; then
		SHOULD_SCAN=0
	else
		# Create lock file and trigger new scan
		touch "$SCAN_LOCK"
		wpa_cli -i wlan0 scan >/dev/null 2>&1
		sleep 2
	fi

	# Get scan results and format as JSON
	echo "{"
	echo "\"networks\": ["

	first=1
	# POSIX sh 不支持 $'\t'（dash/ash 会当成字面量 $\t，字段全部错位、
	# signal 为空还会产出非法 JSON）。制表符属于 IFS 空白类，连续制表符
	# （开放网络的 flags 为空）会被折叠成单个分隔符导致字段错位，
	# 因此先 tr 成非空白控制字符 \037 再按它切分，空字段得以保留。
	wpa_cli -i wlan0 scan_results 2>/dev/null | tail -n +2 | tr '\t' '\037' | while IFS="$(printf '\037')" read -r bssid freq signal flags ssid; do
		# Skip empty SSIDs and header
		[ -z "$ssid" ] || [ "$ssid" = "ssid" ] && continue

		# 信号强度兜底：非数值（含负号）时归零，避免 "signal": 空值破坏 JSON
		case "$signal" in
			''|*[!0-9-]*) signal=0 ;;
		esac

		# Determine security type
		security="Open"
		if echo "$flags" | grep -q "WPA2-PSK"; then
			security="WPA2"
		elif echo "$flags" | grep -q "WPA-PSK"; then
			security="WPA"
		elif echo "$flags" | grep -q "WEP"; then
			security="WEP"
		fi

		# Output JSON without trailing commas
		if [ $first -eq 0 ]; then
			echo ","
		else
			first=0
		fi
		cat <<-NETWORK
		{
			"ssid": "$(json_encode "$ssid")",
			"bssid": "$(json_encode "$bssid")",
			"signal": $signal,
			"security": "$(json_encode "$security")"
		}
		NETWORK
	done

	echo "]"
	echo "}"

	# Clean up lock if we created it
	[ $SHOULD_SCAN -eq 1 ] && rm -f "$SCAN_LOCK"
}

json_response "$(scan_networks)"

