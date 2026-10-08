# booking-shared

Code shared by the booking web and mobile apps, installed straight from this public repo, pinned to a commit (no registry, no tokens):

```json
"@booking/shared": "github:RaminduSamarawickrama/booking-shared#<commit-sha>"
```

| Import | Contents |
| --- | --- |
| `@booking/shared/runtime-config` | Decides which backend an app talks to (saved override, build value, default) and checks its health. Works in browsers and React Native. |
| `@booking/shared/ui/ConnectionPanel` | Web-only React panel for switching backends. |
| `@booking/shared/ui/styles.css` | Web base styles. |

The package builds itself on install (`prepare` runs `tsc`), so consumers get plain JS and type declarations.

## Releasing a change

1. Merge to `main` with CI green and bump `version` in package.json.
2. In each app, replace the `#<commit-sha>` suffix with the new commit and run `npm install`.
   You can pin a tag (`#v0.2.0`) instead if you create one on GitHub.

Apps pin a commit, so a change here never reaches an app until that app opts in.

## Develop

```sh
npm install
npm test
npm run build
```

To try unreleased changes in an app: `npm install ../booking-shared` there (don't commit that).

Enable the secret-blocking pre-commit hook once per clone: `git config core.hooksPath .githooks`

Part of the airport transfer booking platform:

| Repo | What it is |
| --- | --- |
| [booking-engine](https://github.com/RaminduSamarawickrama/booking-engine) | Spring Boot services, Docker Compose, infrastructure and planning docs |
| [booking-shared](https://github.com/RaminduSamarawickrama/booking-shared) | TypeScript shared by every client: backend switching, shared UI |
| [booking-customer-web](https://github.com/RaminduSamarawickrama/booking-customer-web) | Customer website (Vercel) |
| [booking-admin-web](https://github.com/RaminduSamarawickrama/booking-admin-web) | Operations dashboard (Vercel) |
| [booking-customer-mobile](https://github.com/RaminduSamarawickrama/booking-customer-mobile) | Customer app (Expo) |
| [booking-driver-mobile](https://github.com/RaminduSamarawickrama/booking-driver-mobile) | Driver app (Expo) |
