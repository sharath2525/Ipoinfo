# IPO Fast Check

Simple Next.js website for Indian IPO allotment checking and GMP viewing.

## V1 flow

- Select one recent IPO.
- Enter one PAN.
- Click **Check Allotment**.
- The result appears on the same page as Allotted, Not Allotted, Pending, or CAPTCHA Required.
- The GMP tab shows current IPO GMP, GMP percentage, and estimated listing price.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Live data setup

The app uses free public sources by default:

- IPOWatch for live GMP and IPO calendar rows.
- IPO360 for recent allotment release status.
- IPO Ji as a fallback for recently listed IPOs that one source misses.

Optional: add one server-side API key in `.env.local` if you later want an API provider:

```bash
IPOGURU_API_KEY=your_key_here
```

or:

```bash
IPOALERTS_API_KEY=your_key_here
```

Without a key, the app still uses the live public sources. Demo data is used only if live sources are disabled or unavailable.

## Vercel hosting

1. Create a private GitHub repository and push this project.
2. Create a free Vercel account.
3. Import the GitHub repository in Vercel.
4. Deploy. The free public-source setup works without an API key.
5. Optional: add `IPOGURU_API_KEY` or `IPOALERTS_API_KEY` in Vercel Project Settings -> Environment Variables only if you later get permitted access.
6. Buy a domain such as `yourbrand.online`, then connect it in Vercel under Project Settings -> Domains.
7. Point the domain DNS to Vercel using the DNS records Vercel shows.

Vercel Hobby is enough for the first version. Upgrade later only if traffic or commercial usage requires it.

## Scraping note

Do not make the production website depend on scraping as the primary data source.
Public blog pages can change layout, return empty client-side tables, or block server traffic.
Use scraping only as a backup cache job if the source permits it. The safer primary setup is a fintech API key.

## Current behavior

- IPO and GMP lists use the previous month, current month, next month, and upcoming IPOs.
- IPOWatch GMP is fetched from the live GMP page.
- Previous/current/next month IPO calendars are merged in so completed IPOs are available for allotment selection.
- IPOWatch, IPO360, and IPO Ji allotment data are merged in so recent completed IPOs show live release updates such as "Out: 28 Aug, 10:30 PM" or "Due Today".
- The allotment dropdown shows only last-month and this-month completed/result IPOs, newest first.
- MUFG Intime and KFinTech rows are checked on the same page through their official public flows.
- Bigshare rows load the official CAPTCHA inside this site, then submit the PAN and CAPTCHA answer to show the result on the same page.
- Skyline, Cameo, Maashitla, Purva, and other CAPTCHA/protected registrars show the official action link until a supported in-page flow is added.
- The result can distinguish Allotted, Not Allotted, Not Applied, Pending, CAPTCHA Required, and Official Check/Unavailable.
- PAN numbers are not stored in URLs, browser storage, logs, or a database.
- Fully automatic checks for every registrar need a permitted registrar, exchange, or data-provider API before production use.
