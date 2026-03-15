################################################################################
#
# imapautoclean
#
################################################################################

IMAPAUTOCLEAN_SITE_METHOD = git
IMAPAUTOCLEAN_SITE = git@github.com:iborderxm/imapautoclean.git
IMAPAUTOCLEAN_SITE_BRANCH = master
IMAPAUTOCLEAN_VERSION = $(shell git ls-remote $(IMAPAUTOCLEAN_SITE) $(IMAPAUTOCLEAN_SITE_BRANCH) | head -1 | cut -f1)

IMAPAUTOCLEAN_LICENSE = MIT
IMAPAUTOCLEAN_LICENSE_FILES = LICENSE
IMAPAUTOCLEAN_DEPENDENCIES += mbedtls

IMAPAUTOCLEAN_INSTALL_STAGING = YES
IMAPAUTOCLEAN_INSTALL_TARGET = YES

define IMAPAUTOCLEAN_BUILD_CMDS
    $(TARGET_CONFIGURE_OPTS) $(MAKE) LDFLAGS="$(TARGET_LDFLAGS)" -C $(@D) $(MAKE_OPTS) CFLAGS="-std=gnu99 -Os" imap_cleaner
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