# CalcInk

A web notebook that does your arithmetic. Write an expression by hand, end it with `=`, and the
answer appears on the page next to it. Change the expression and the answer follows.

Everything runs in the browser: stroke capture, handwriting recognition and evaluation. There is
no server and nothing is sent anywhere.

Built for the Inter IIT Tech Meet 15.0 Bootcamp, Phase 1 Software problem statement
([docs/problem-statement.pdf](docs/problem-statement.pdf)).

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

## Scripts

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start the dev server               |
| `npm run build`   | Type-check, then build to `dist/`  |
| `npm run preview` | Serve the production build locally |
| `npm test`        | Run the unit tests once            |
| `npm run lint`    | Lint the source                    |
| `npm run format`  | Format the source with Prettier    |
