################################################################################
#
# imapautoclean
#
################################################################################

IMAPAUTOCLEAN_SITE_METHOD = git
IMAPAUTOCLEAN_SITE = https://github.com/iborderxm/imapautoclean.git
IMAPAUTOCLEAN_SITE_BRANCH = master
IMAPAUTOCLEAN_VERSION = $(shell git ls-remote $(IMAPAUTOCLEAN_SITE) $(IMAPAUTOCLEAN_SITE_BRANCH) | head -1 | cut -f1)

IMAPAUTOCLEAN_LICENSE = MIT
IMAPAUTOCLEAN_LICENSE_FILES = LICENSE
IMAPAUTOCLEAN_DEPENDENCIES += mbedtls

IMAPAUTOCLEAN_INSTALL_STAGING = YES
IMAPAUTOCLEAN_INSTALL_TARGET = YES

IMAPAUTOCLEAN_LDFLAGS += -lmbedtls -lmbedx509 -lmbedcrypto
IMAPAUTOCLEAN_LDFLAGS += $(TARGET_LDFLAGS) \
	-L$(STAGING_DIR)/usr/lib \
	-L$(TARGET_DIR)/usr/lib

IMAPAUTOCLEAN_CFLAGS += \
	-I$(STAGING_DIR)/usr/include

define IMAPAUTOCLEAN_BUILD_CMDS
	$(MAKE) \
		ARCH=$(TARGET_ARCH) \
		CROSS_COMPILE=$(TARGET_CROSS) \
		EXTRA_CFLAGS="$(IMAPAUTOCLEAN_CFLAGS)" \
		EXTRA_LDFLAGS="$(IMAPAUTOCLEAN_LDFLAGS)" \
		-C $(@D)
endef

define IMAPAUTOCLEAN_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/imap_cleaner \
		$(TARGET_DIR)/usr/bin/imap_cleaner
endef

define IMAPAUTOCLEAN_INSTALL_STAGING_CMDS
	$(INSTALL) -D -m 0755 $(@D)/imap_cleaner \
		$(STAGING_DIR)/usr/bin/imap_cleaner
endef

$(eval $(generic-package))