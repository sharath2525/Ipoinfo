# IPO Fast Check

A fast, mobile-friendly website for checking recent Indian IPO allotment results and viewing current Grey Market Premium information.

**Live website:** [ipoinfo.online](https://ipoinfo.online)

## Features

- Check one PAN against a recently completed IPO.
- Automatically begin checking when a valid PAN is entered.
- Display clear Allotted, Not Allotted, Not Applied, Pending and CAPTCHA states.
- Browse Open, Upcoming and recently Closed IPOs.
- View GMP, price band, lot size, important dates and estimated listing price.
- Support both Mainboard and SME IPOs with a responsive mobile interface.

## How It Works

1. Select a recently completed IPO.
2. Enter a valid PAN number.
3. View the allotment result or complete the official registrar CAPTCHA when required.

PAN details are used only for the requested check and are not stored on the server. Users may optionally remember a PAN locally on their own device.

## Development

Built with Next.js and deployed on Vercel.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for local development.

## Disclaimer

IPO allotment results depend on official registrar availability. GMP is unofficial market information and does not guarantee a listing price or investment return.
