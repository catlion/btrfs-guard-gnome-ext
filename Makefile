UUID := $(shell sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
VERSION := $(shell sed -n 's/.*"version": *\([0-9]*\).*/\1/p' metadata.json)
ZIP := out/$(UUID)-v$(VERSION).shell-extension.zip

.PHONY: zip clean

zip: $(ZIP)

$(ZIP): extension.js prefs.js metadata.json schemas/org.gnome.shell.extensions.btrfs-guard.gschema.xml $(wildcard po/*.po) LICENSE
	mkdir -p out
	gnome-extensions pack . -o out --force \
	  --schema=schemas/org.gnome.shell.extensions.btrfs-guard.gschema.xml \
	  --podir=po --gettext-domain=btrfs-guard \
	  --extra-source=LICENSE
	mv out/$(UUID).shell-extension.zip $(ZIP)

clean:
	rm -f out/*.zip
