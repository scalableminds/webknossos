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
- the backend uses Scala, sbt and the Play framework

Code Verification: 
- Scala type-checking: `sbt --client compile`. This will also compile the subprojects it depends on.
- Unit tests: `yarn test-backend`
- Formatting: `yarn fix-backend`


## Pull Requests
- run all the appropriate checks above
- use the PR template at `.github/PULL_REQUEST_TEMPLATE.md


# Scripting & Command Permissions
- Never ever use `rm` commands on OSX platforms. Instead use the safer `trash` command. This prevents accidental permanent deletion.