#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 TARGET_DIR" >&2
  exit 1
fi

target_dir=$1

if [ ! -d "$target_dir" ]; then
  echo "Missing target directory: $target_dir" >&2
  exit 1
fi

cd $target_dir

mkdir -p overlay/etc/init.d
mkdir -p overlay/usr/sbin

# 配置系统时区
echo "配置系统时区"
echo "CST-8" > overlay/etc/TZ
echo "Asia/Shanghai" > overlay/etc/timezone
sed -i "s|GMT0|CST-8|g" overlay/etc/init.d/S01timezone

cp -r custom/root overlay/etc/cron/crontabs/root
cp -r custom/persondetection.json overlay/etc/persondetection.json
cp -r custom/S99send2email_persondetection overlay/etc/init.d/S99send2email_persondetection
cp -r custom/send2email_persondetection overlay/usr/sbin/send2email_persondetection
cp -r custom/process_monitor overlay/usr/sbin/process_monitor
cp -r custom/checknet overlay/usr/sbin/checknet
cp -r custom/checknet_prompt overlay/usr/sbin/checknet_prompt
cp -r custom/S40network overlay/etc/init.d/S40network
cp -r custom/odhcp6c overlay/etc/network/if-up.d/odhcp6c
# Wi-Fi改密工具：wifichange "新SSID" "新密码"
cp -r custom/wifichange overlay/usr/sbin/wifichange
# Wi-Fi二维码扫码换网工具：wifiqrscan
cp -r custom/wifiqrscan overlay/usr/sbin/wifiqrscan
cp -r custom/imapautoclean overlay/usr/sbin/imapautoclean
# 移除开机播放thingino.opus音效
cp -r custom/S97sysupgrade overlay/etc/init.d/S97sysupgrade
# 配置xfrpc
cp -r custom/xfrpc-mipsel-linux-musl overlay/usr/sbin/xfrpc
cp -r custom/xfrpc-ctl overlay/usr/sbin/xfrpc-ctl
cp -r custom/xfrpc.toml overlay/etc/xfrpc.toml
cp -r custom/S99xfrpc overlay/etc/init.d/S99xfrpc

# 配置hostc (Cloudflare Worker Tunnel 客户端)
cp -r custom/hostc overlay/usr/sbin/hostc
cp -r custom/S99hostc overlay/etc/init.d/S99hostc

# 智能跟随 / AI人形追踪
# 电机控制脚本 custom\ptz_person_follow
cp -r custom/ptz_person_follow overlay/usr/sbin/ptz_person_follow

chmod 755 overlay/etc/init.d/*
chmod 755 overlay/usr/sbin/*

# 电机motors配置文件
cp -r custom/motors.json configs/cameras/iflytek_xfp301m_t31x_jxq03_ssv6155/motors.json

mkdir -p overlay/usr/share/sounds/other
cp -r custom/sounds/. overlay/usr/share/sounds/other/
find overlay/usr/share/sounds/other/ -maxdepth 1 -type f -exec chmod 0644 {} +

cp -r custom/prudynt.json package/prudynt-t/files/prudynt.json
cp -r custom/send2email package/prudynt-t/files/send2email

# 配置thingino-sounds
cp -r custom/package/thingino-sounds package
echo "thingino-sounds 配置完成"

# 配置quirc
cp -r custom/package/quirc package/quirc
sed -i '/source "$BR2_EXTERNAL_THINGINO_PATH\/package\/lightnvr\/Config.in"/a source "$BR2_EXTERNAL_THINGINO_PATH\/package\/quirc\/Config.in"' Config.in
sed -i '$a BR2_PACKAGE_QUIRC=y' configs/cameras/iflytek_xfp301m_t31x_jxq03_rtl8188ftv/iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig
echo "quirc 配置完成:"
cat Config.in | grep quirc -A 3

# 配置imapautoclean
cp -r custom/package/imapautoclean package/imapautoclean
sed -i '/source "$BR2_EXTERNAL_THINGINO_PATH\/package\/lightnvr\/Config.in"/a source "$BR2_EXTERNAL_THINGINO_PATH\/package\/imapautoclean\/Config.in"' Config.in
sed -i '$a BR2_PACKAGE_IMAPAUTOCLEAN=y' configs/cameras/iflytek_xfp301m_t31x_jxq03_rtl8188ftv/iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig
echo "imapautoclean 配置完成:"
cat Config.in | grep imapautoclean -A 3

# 配置thingino-button
rm -rf package/thingino-button
cp -r custom/package/thingino-button package/thingino-button

echo "iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig 配置完成"
cat configs/cameras/iflytek_xfp301m_t31x_jxq03_rtl8188ftv/iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig

# 更新覆盖thingino-webui和wifi
cp -rf custom/package/thingino-webui package
cp -rf custom/package/wifi package
# 更新覆盖thingino-wpa_supplicant（裁剪：CONFIG_NO_STDOUT_DEBUG + 默认关闭漫游/syslog）
cp -rf custom/package/thingino-wpa_supplicant package
cat custom/package/wifi/files/index.html | grep "<title>"
echo "更新覆盖thingino-webui和wifi 配置完成:"
cat package/wifi/files/index.html | grep "<title>"

# 替换bootstrap国内cdn
echo "替换bootstrap国内cdn 配置:"
cd package/thingino-webui/files/www
sed -i "s|integrity=|integrity1=|g" *.html
target_key="bootstrap.min.css"
result=$(grep -r "$target_key" . --include="*.html" | \
grep 'href=' | \
sed -n 's/.*href="\([^"]*'$target_key'[^"]*\)".*/\1/p' | \
sort | uniq)
for item in $result
do
    echo "$item"
    sed -i "s|$item|https://cdn.bootcdn.net/ajax/libs/bootstrap/5.3.8/css/bootstrap.min.css|g" *.html
done

target_key="bootstrap-icons.min.css"
result=$(grep -r "$target_key" . --include="*.html" | \
grep 'href=' | \
sed -n 's/.*href="\([^"]*'$target_key'[^"]*\)".*/\1/p' | \
sort | uniq)
for item in $result
do
    echo "$item"
    sed -i "s|$item|https://cdn.bootcdn.net/ajax/libs/bootstrap-icons/1.13.1/font/bootstrap-icons.min.css|g" *.html
done

target_key="bootstrap.bundle.min.js"
result=$(grep -r "$target_key" . --include="*.html" | \
grep 'src=' | \
sed -n 's/.*src="\([^"]*'$target_key'[^"]*\)".*/\1/p' | \
sort | uniq)
for item in $result
do
    echo "$item"
    sed -i "s|$item|https://cdn.bootcdn.net/ajax/libs/bootstrap/5.3.3/js/bootstrap.bundle.min.js|g" *.html
done

# 替换时区
echo "替换时区 配置:"
sed -i "s|GMT0|CST-8|g" x/*.cgi
sed -i "s|GMT0|CST-8|g" x/*.raw