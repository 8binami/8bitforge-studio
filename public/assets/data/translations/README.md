The themed build ships its own translation manager, which fetches this file on
load. The studio does not use it (translation lives in `src/i18n/`) so the
file is deliberately empty: it exists to keep a 404 out of the console.

It goes when the theme does.
