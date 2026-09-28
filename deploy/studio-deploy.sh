#!/bin/bash
# Publish the studio's web build at studio.8bitforge.com.
#
# The only thing the studio-deploy account can run: sshd forces it
# (ForceCommand), whatever the client asks for. It reads a .tar.gz of
# dist/web on standard input, checks it, and swaps it in for the live site
# in one rename, keeping the version it replaces for a rollback.
#
#   tar -czf - -C dist/web . | ssh studio-deploy            # publish
#   ssh studio-deploy rollback                               # the one before
#
# Installed as /usr/local/bin/studio-deploy, owned by root, mode 755.

set -euo pipefail
umask 027

SITE=/srv/8binami/studio.8bitforge.com
LIVE="$SITE/public"
PREVIOUS="$SITE/previous"
# The build is about 20 MB; ten times that is not a build.
MAX_BYTES=$((200 * 1024 * 1024))

fail() { echo "studio-deploy: $*" >&2; exit 1; }

# Swap two directories. In one rename where the file system can (ext4,
# tmpfs: RENAME_EXCHANGE), so there is no moment without a site; otherwise
# in two, a few microseconds apart.
swap() {
    mv -T --exchange "$1" "$2" 2>/dev/null && return
    local parked
    parked="$(dirname "$1")/.parked.$$"
    mv -T "$2" "$parked" && mv -T "$1" "$2" && mv -T "$parked" "$1"
}

case "${SSH_ORIGINAL_COMMAND:-publish}" in
    publish) ;;
    rollback)
        [ -d "$PREVIOUS" ] || fail "there is no previous version to go back to"
        swap "$PREVIOUS" "$LIVE"
        echo "Rolled back: the previous version is live again, and the one it replaced kept in its place."
        exit 0
        ;;
    *) fail "unknown command; allowed: publish (the default) and rollback" ;;
esac

WORK=$(mktemp -d "$SITE/.incoming.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/build.tar.gz"

# At most MAX_BYTES read, and one more to tell a full archive from a cut one.
head -c $((MAX_BYTES + 1)) > "$ARCHIVE"
[ -s "$ARCHIVE" ] || fail "nothing was received"
[ "$(stat -c %s "$ARCHIVE")" -le "$MAX_BYTES" ] || fail "the archive is larger than $((MAX_BYTES / 1024 / 1024)) MB"

# Look before extracting: only plain files and directories, no absolute path,
# no "..", no link of any kind: a link could point extraction, or Apache,
# anywhere on the disk.
LISTING=$(tar -tvzf "$ARCHIVE") || fail "this is not a .tar.gz"
if awk '{ t = substr($1, 1, 1); if (t != "-" && t != "d") bad = 1 } END { exit !bad }' <<< "$LISTING"; then
    fail "the archive holds something that is neither a file nor a directory"
fi
if grep -q ' link to ' <<< "$LISTING"; then fail "the archive holds a link"; fi
if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then fail "the archive holds a path outside itself"; fi

mkdir "$WORK/site"
tar -xzf "$ARCHIVE" -C "$WORK/site" --no-same-owner --no-same-permissions
[ -f "$WORK/site/index.html" ] || fail "the archive has no index.html at its root: is it dist/web?"

# Readable by Apache through its group, and by nobody else. The group is
# handed down by the setgid directory: this account is not in www-data, on
# purpose, so it cannot set the group itself: only check that it holds.
chmod -R u=rwX,g=rX,o= "$WORK/site"
if [ -n "$(find "$WORK/site" ! -group www-data -print -quit)" ]; then
    fail "the files would not belong to www-data, and Apache could not read them; is $SITE setgid www-data?"
fi

# The new version is live, and the old one is now at $WORK/site.
swap "$WORK/site" "$LIVE"
rm -rf "$PREVIOUS"
mv -T "$WORK/site" "$PREVIOUS"

echo "Published: $(find "$LIVE" -type f | wc -l) files live at https://studio.8bitforge.com/ (npm run deploy:web -- rollback goes back)."
