# Development Workflows

## Frontend
- the frontend uses TypeScript, React, Ant Design (antd), Redux, Redux-Saga and Three.js
- we use yarn for managing dependencies and running commands

Code Verification:
- TypeScript type-checking: `yarn typecheck`
- Unit tests (vitest): `yarn test`
- Formatting (biome): `yarn fix-frontend` 
- Linting (biome): `yarn check-frontend`


## Backend 
- the backend uses Scala, Mill (`./mill`, configured in `build.mill`) and the Play framework

Code Verification: 
- Scala type-checking: `./mill compile`. This will also compile the subprojects it depends on. `./mill __.compile` also compiles the tests.
- Unit tests: `yarn test-backend`
- Formatting and linting: `yarn fix-backend`


## Pull Requests
- run all the appropriate checks above
- use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`
- keep your summaries short and to the point


# Scripting & Command Permissions
- Never ever use `rm` commands on OSX platforms. Instead use the safer `trash` command. This prevents accidental permanent deletion.