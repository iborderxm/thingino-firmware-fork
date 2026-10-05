################################################################################
#
# Thingino package overrides entry point
#
################################################################################

# Add new overrides here so we only need a single BR2_PACKAGE_OVERRIDE_FILE.
# Keep the includes alphabetized for readability.

# Allow developers to keep personal overrides in either the root local.mk
# (ignored by git) or the default $(CONFIG_DIR)/local.mk without losing this
# aggregated file.
-include $(BR2_EXTERNAL)/local.mk
-include $(CONFIG_DIR)/local.mk

################################################################################
#
# GCC 15: 全局禁用限定符通用宏 (qualifier-generic macros)
#
# 背景:
#   最新 ISO C 草案 (N3322, C2Y) 要求 bsearch、memchr、strchr、strstr 等
#   函数的返回值限定符 (const/volatile) 随入参推导。GCC 15 配合
#   glibc 2.42+ 的系统头文件时, 通过 _Generic 关键字把这些函数实现成了
#   "限定符通用宏", 并默认开启 (-fqualifier-generic-macros)。
#
#   而项目中部分包自带的旧版 Gnulib (例如 libunistring 1.4.1、gettext 等)
#   仍会用如下方式重新声明这些标准库函数:
#       _GL_EXTERN_C void *bsearch (...);
#   此时 bsearch 已被展开为 _Generic 宏, 导致语法解析错误而编译失败。
#
# 方案:
#   在全局 CFLAGS 中追加 -fno-qualifier-generic-macros 关闭该新特性。
#   该文件通过 system.fragment 中的 BR2_PACKAGE_OVERRIDE_FILE 指定,
#   由 Buildroot 主 Makefile 在 package/Makefile.in 之后统一包含,
#   因此对所有 target/host 包 (含 autotools 的 configure 阶段探测、
#   交叉编译时使用的 *_FOR_BUILD 工具) 均生效。
#
################################################################################

# 宿主编译器 (HOSTCC) 能力探测: 仅当编译器真正识别该选项时才追加。
# 加 -Werror 使旧 GCC 的 "unrecognized command-line option" 告警也判定为
# 失败, 从而同时兼容 GCC 14 及更早版本 (如 debian:trixie 构建容器) 与 clang。
# 结果缓存到简单变量, 保证探测只执行一次。
THG_FNO_QUALIFIER_GENERIC_MACROS := \
	$(shell $(HOSTCC) -Werror -fno-qualifier-generic-macros \
		-E -x c /dev/null -o /dev/null >/dev/null 2>&1 \
		&& echo -fno-qualifier-generic-macros)

# 所有 host 包: HOST_CFLAGS 同时也是目标包 *_FOR_BUILD 变量的来源。
# 同时显式追加到 C++ 标志, 避免依赖变量间的隐式传递 (重复选项无害)。
HOST_CFLAGS += $(THG_FNO_QUALIFIER_GENERIC_MACROS)
HOST_CXXFLAGS += $(THG_FNO_QUALIFIER_GENERIC_MACROS)

# 所有 target 包: musl/uclibc 头文件本身不提供限定符通用宏, 仅当目标
# 工具链为 GCC 15 及以上时追加, 避免旧版本编译器收到未知选项。
ifeq ($(BR2_TOOLCHAIN_GCC_AT_LEAST_15),y)
TARGET_CFLAGS += -fno-qualifier-generic-macros
TARGET_CXXFLAGS += -fno-qualifier-generic-macros
endif

include $(BR2_EXTERNAL)/package/thingino-freetype/freetype-override.mk
include $(BR2_EXTERNAL)/package/thingino-libwebsockets/libwebsockets-override.mk
include $(BR2_EXTERNAL)/package/thingino-live555/live555-override.mk
include $(BR2_EXTERNAL)/package/thingino-mbedtls/mbedtls-override.mk
include $(BR2_EXTERNAL)/package/thingino-mosquitto/mosquitto-override.mk
include $(BR2_EXTERNAL)/package/thingino-mxml/mxml-override.mk
