# iolinki.com

Static product website for the IO-Link device and master stacks. GitHub Pages
publishes the repository root from `master` to `https://iolinki.com/`.

## Check the site

Use Node 22 or newer and Python 3:

```sh
python3 scripts/check_site.py
npm ci
npx playwright install chromium
npm run check:browser
```

The browser check starts a local server and exercises the customer pages at
1440, 390 and 320 pixels, including mobile navigation, FAQ expansion, license
selection and the disabled checkout state. Screenshots are written to
`artifacts/browser/`. Use an installed Chrome with
`CHROME_BIN=/usr/bin/google-chrome npm run check:browser`.

After a Pages deployment, verify the public site with:

```sh
SITE_URL=https://iolinki.com npm run check:browser
```

Site styling and navigation live in `assets/css/site.css` and
`assets/js/site.js`. Technical guides retain their public URLs and anchors.

## Purchasing

The checkout implementation and its separate tests are in `checkout-worker/`.
Follow its README for configuration and verification. Public checkout is
disabled until approved purchase terms and payment/delivery configuration are
ready. Passing tests with simulated Stripe/email responses does not establish
a real payment or external email delivery.

Personal address disclosure: do not publish the owner’s street address in marketing pages, shared footers, metadata, or examples. Keep any legally required business address confined to the directly accessible seller information page. Apply this preference to future website changes; do not copy personal details from other projects unnecessarily.

## Agents and IODD tools

Start at [llms.txt](llms.txt) or read the [iolinki skill](plugins/iolinki/skills/iolinki/SKILL.md).
The [agent guide](docsite/content/tools/agents.md) covers skill/plugin installation
and project instructions. [MCP setup](https://iolinki.com/iodd-mcp.html) includes
hosted and one-command local connections for the main clients.

The portable plugin lives in `plugins/iolinki`; its repo marketplace is
`.agents/plugins/marketplace.json`. Build its public archive and full plain-text
instructions with `python3 scripts/package-agent-plugin.py`, then check with
`--check`. Keep package manifests and tool instructions consistent with the
actual deployed MCP endpoint. Public Plugins Directory publication requires a
separate submission; the repo package does not imply a public listing.
