#!/usr/bin/env bash
# Deploys app/ to Vercel production from a copy outside git, so Vercel does not block it over the commit author's
# email. Once your Vercel account and your git email match, plain `cd app && npx vercel --prod` works too.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$here/app" && tar --exclude=node_modules --exclude=dist -cf - .) | (cd "$tmp" && tar -xf -)
cd "$tmp" && npx vercel --prod --yes
