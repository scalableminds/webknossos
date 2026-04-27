# Development Workflows

## Frontend
- the frontend uses TypeScript, React, Ant Design (antd), Redux and Three.js
- we use yarn for managing dependencies and running commands

Code Verification:
- TypeScript type-checking: `yarn typecheck`
- Unit tests (vitest): `yarn test`
- Formatting (biome): `yarn fix-format` 
- Linting (biome): `yarn check-frontend`


## Backend 
- the backend uses Scala, sbt and the Play framework

Code Verification: 
- Scala type-checking: `sbt compile`
- Unit tests: `yarn test-backend`
- Formatting: `yarn format-backend`


## Pull Requests
- run all the appropriate checks above
- use the PR template at `.github/PULL_REQUEST_TEMPLATE.md
