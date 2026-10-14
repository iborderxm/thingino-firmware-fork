################################################################################
#
# quirc
#
################################################################################

QUIRC_SITE_METHOD = git
QUIRC_SITE = https://github.com/iborderxm/quirc.git
QUIRC_SITE_BRANCH = master
QUIRC_VERSION = $(shell git ls-remote $(QUIRC_SITE) $(QUIRC_SITE_BRANCH) | head -1 | cut -f1)
# git ls-remote https://github.com/iborder/quirc master | head -1 | cut -f1

QUIRC_LICENSE = ISC
QUIRC_LICENSE_FILES = LICENSE
QUIRC_DEPENDENCIES += jpeg

QUIRC_INSTALL_STAGING = YES
QUIRC_INSTALL_TARGET = YES

define QUIRC_BUILD_CMDS
    $(TARGET_CONFIGURE_OPTS) $(MAKE) LDFLAGS="$(TARGET_LDFLAGS)" -C $(@D) $(MAKE_OPTS) CFLAGS="-std=gnu99 -DQUIRC_FLOAT_TYPE=float -DQUIRC_USE_TGMATH=yes" quirc-scan
endef

define QUIRC_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/quirc-scan \
		$(TARGET_DIR)/usr/bin/quirc-scan
endef

define QUIRC_INSTALL_STAGING_CMDS
	$(INSTALL) -D -m 0755 $(@D)/quirc-scan \
		$(STAGING_DIR)/usr/bin/quirc-scan
endef

$(eval $(generic-package))