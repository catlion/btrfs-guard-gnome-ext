UUID := $(shell sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
VERSION := $(shell sed -n 's/.*"version": *\([0-9]*\).*/\1/p' metadata.json)
ZIP := out/$(UUID)-v$(VERSION).shell-extension.zip

.PHONY: zip test clean

zip: $(ZIP)

$(ZIP): extension.js prefs.js metadata.json schemas/org.gnome.shell.extensions.btrfs-guard.gschema.xml $(wildcard po/*.po) LICENSE
	mkdir -p out
	gnome-extensions pack . -o out --force \
	  --schema=schemas/org.gnome.shell.extensions.btrfs-guard.gschema.xml \
	  --podir=po --gettext-domain=btrfs-guard \
	  --extra-source=LICENSE
	mv out/$(UUID).shell-extension.zip $(ZIP)

# Run the packaged extension in a throwaway nested GNOME Shell (own D-Bus
# session, XDG_DATA_HOME and XDG_CONFIG_HOME under out/test), so neither the
# installed copy nor your dconf settings are touched.
#   make test                              English UI, schema-default mounts
#   make test TEST_LANG=ru_RU.UTF-8        other UI language
#   make test MOUNTS="['/', '/home']"      override watched mounts (exported to the session)
TEST_LANG ?= en_US.UTF-8
TEST_DIR := $(CURDIR)/out/test
TEST_EXT := $(TEST_DIR)/data/gnome-shell/extensions/$(UUID)

test: $(ZIP)
	rm -rf $(TEST_DIR)
	mkdir -p $(TEST_DIR)/config $(TEST_EXT)
	unzip -q $(ZIP) -d $(TEST_EXT)
	glib-compile-schemas $(TEST_EXT)/schemas
	XDG_DATA_HOME=$(TEST_DIR)/data XDG_CONFIG_HOME=$(TEST_DIR)/config \
	LANG=$(TEST_LANG) LC_ALL=$(TEST_LANG) LANGUAGE=$(firstword $(subst _, ,$(TEST_LANG))) \
	dbus-run-session -- sh -c '\
	  gsettings set org.gnome.shell enabled-extensions "[\"$(UUID)\"]" && \
	  gsettings set org.gnome.shell welcome-dialog-last-shown-version 999 && \
	  { [ -z "$$MOUNTS" ] || gsettings --schemadir $(TEST_EXT)/schemas set org.gnome.shell.extensions.btrfs-guard mounts "$$MOUNTS"; } && \
	  exec gnome-shell --devkit --wayland'

clean:
	rm -f out/*.zip
	rm -rf out/test
