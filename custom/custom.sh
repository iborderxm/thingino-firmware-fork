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

# 修复thingino-jct编译错误
cp -r custom/patch/0001-strtok_2_strtok_r.patch package/thingino-jct/

# 配置时区
echo "CST-8" > overlay/etc/TZ
echo "Asia/Shanghai" > overlay/etc/timezone

cp -r custom/root overlay/etc/cron/crontabs/root
cp -r custom/persondetection.json overlay/etc/persondetection.json
cp -r custom/S99send2email_persondetection overlay/etc/init.d/S99send2email_persondetection
cp -r custom/send2email_persondetection overlay/usr/sbin/send2email_persondetection
cp -r custom/process_monitor overlay/usr/sbin/process_monitor
cp -r custom/checknet overlay/usr/sbin/checknet
cp -r custom/checknet_prompt overlay/usr/sbin/checknet_prompt
cp -r custom/imapautoclean overlay/usr/sbin/imapautoclean

chmod 755 overlay/etc/init.d/*
chmod 755 overlay/usr/sbin/*

mkdir -p overlay/usr/share/sounds/other
cp -r custom/sounds/* overlay/usr/share/sounds/other/
chmod 0644 overlay/usr/share/sounds/other/*

cp -r custom/prudynt.json package/prudynt-t/files/prudynt.json
cp -r custom/send2email package/thingino-send2/files/send2email

# 配置imapautoclean
cp -r custom/package/imapautoclean package/imapautoclean
sed -i '/source "$BR2_EXTERNAL_THINGINO_PATH\/package\/lightnvr\/Config.in"/a source "$BR2_EXTERNAL_THINGINO_PATH\/package\/imapautoclean\/Config.in"' Config.in
cat Config.in | grep imapautoclean

sed -i '$a BR2_PACKAGE_IMAPAUTOCLEAN=y' configs/cameras/iflytek_xfp301m_t31x_jxq03_rtl8188ftv/iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig 
cat configs/cameras/iflytek_xfp301m_t31x_jxq03_rtl8188ftv/iflytek_xfp301m_t31x_jxq03_rtl8188ftv_defconfig

# 替换bootstrap国内cdn
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
sed -i "s|GMT0|CST-8|g" x/*.cgi
sed -i "s|GMT0|CST-8|g" x/*.raw
sed -i "s|GMT0|CST-8|g" $GITHUB_WORKSPACE/overlay/etc/init.d/S01timezone