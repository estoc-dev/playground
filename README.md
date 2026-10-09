# Estoc playground

Interactive explanations of the parts Estoc is made of. Each page loads the
published package from npm and runs it in the browser, so what you see is
what the package answers.

Live at <https://estoc-dev.github.io/playground/>.

| Page | Package |
| --- | --- |
| [Continuity](https://estoc-dev.github.io/playground/continuity/) | [`@estoc/continuity`](https://www.npmjs.com/package/@estoc/continuity) |

## Working on it

```
pnpm install
pnpm dev        # http://localhost:5173/continuity/
pnpm test       # the answers the prose claims, checked against the package
pnpm build      # dist/, deployed to GitHub Pages from main
```

A page is a directory with its own `index.html`, listed in
`vite.config.ts` and on the home page. Its code lives under `src/<page>/`;
`src/shared/style.css` holds the colours and type every page shares.

Where the prose states what the model answers, the scenario carries that
answer as a claim (`src/continuity/scenarios.ts`), and `pnpm test` checks
every claim against the installed package. Upgrading the package therefore
fails the tests before the page says something the package no longer does.

## License

Apache-2.0
