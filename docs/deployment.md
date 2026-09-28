# Publishing the web studio

`studio.8bitforge.com` serves the hosted build (`npm run build:hosted`) as
static files from `/srv/8binami/studio.8bitforge.com/public`, through the
Apache vhosts in `deploy/apache/`.

```bash
npm run deploy:web              # build, send, swap in (asks for the password)
npm run deploy:web -- rollback  # put the previous version back
```

## How it works

`scripts/deploy-web.js` builds the hosted version itself, so what is sent can
only be a build with the account in it, and streams `dist/web`: sourcemaps
left behind: as a `.tar.gz` over ssh, to the host and account named in
`deploy.config.json`.

On the server, the deploy account (called `deploy-account` below; the real
name lives only in `deploy.config.json`) has a password and one thing it can
do (`studio-deploy` is the name of the script it runs).
sshd forces `deploy/studio-deploy.sh` (installed as
`/usr/local/bin/studio-deploy`) whatever the client asks: no shell, no
terminal, no forwarding, no `scp`. The script:

- refuses an archive holding anything but plain files and directories: no
  link, no absolute path, no `..`: before extracting it;
- refuses one with no `index.html` at its root, or bigger than 200 MB;
- checks every file will belong to `www-data`, so Apache can read it;
- swaps the new version in for the live one in one rename, so there is no
  moment without a site, and keeps the one it replaced for `rollback`.

The account is not in the `www-data` group: that would let it read the
API's configuration: and may only traverse `/srv/8binami`, through an ACL.
It owns `studio.8bitforge.com/`, whose setgid bit hands `www-data` down to
every file it writes.

All of this was tried in a Debian 13 container with a real sshd: the
password publishes; a wrong one, a shell, a terminal, a tunnel and `scp` are
refused; seven kinds of bad archive are refused and leave the live site as
it was; rollback swaps back. Then for real on the VPS, 2026-09-22: published in ten
seconds, build included; a shell and a terminal refused; rolled back and
forth.

## Setting the account up (once, as `debian`)

Put `deploy/studio-deploy.sh` on the server, then:

```bash
sudo apt install -y acl
sudo install -o root -g root -m 755 studio-deploy.sh /usr/local/bin/studio-deploy
sudo useradd --badname --create-home --shell /bin/bash deploy-account
sudo passwd deploy-account

D=/srv/8binami/studio.8bitforge.com
sudo chown -R deploy-account:www-data $D
sudo find $D -type d -exec chmod 2750 {} + && sudo find $D -type f -exec chmod 640 {} +
sudo setfacl -m u:deploy-account:x /srv/8binami
```

Keep the password in a password manager. Then the SSH rule,
which allows a password for this account alone and nothing but the script:

```
# /etc/ssh/sshd_config.d/studio-deploy.conf
Match User deploy-account
    PasswordAuthentication yes
    ForceCommand /usr/local/bin/studio-deploy
    PermitTTY no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitUserRC no
```

```bash
sudo sshd -t && sudo systemctl reload ssh
```

A password on the internet is guessed at all day: fail2ban bans an address
after a few wrong ones (`sudo fail2ban-client status sshd` shows it working).

## On the machine that publishes

`deploy.config.json`, beside `package.json`, says where and as whom. Git
ignores it; `deploy.config.example.json` shows its shape:

```json
{
    "host": "your.server.ip",
    "port": 22,
    "user": "deploy-account",
    "password": ""
}
```

With the password in it, `npm run deploy:web` asks nothing: ssh gets it
through `SSH_ASKPASS`, from the environment of the one command, never from
its command line or a file. Left empty, ssh asks for it. On Windows the
script runs Git's ssh, which can use the askpass script; `"ssh"` in the file
names another. The host is the VPS's own address: Cloudflare carries the
web, not SSH: which is why that address, and the account's name, are kept
out of this public repository: Cloudflare stands in front of the sites so
that nobody needs to know where they really are.
