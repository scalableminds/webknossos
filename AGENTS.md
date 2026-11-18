# Development Workflows

## Frontend
- the frontend uses TypeScript, React, Ant Design (antd), Redux, Redux-Saga and Three.js
- we use yarn for managing dependencies and running commands

Code Verification:
- TypeScript type-checking: `yarn typecheck`
- Unit tests (vitest): `yarn test`
- Formatting (biome): `yarn fix-frontend` 
- Linting (biome): `yarn check-frontend`

Beware of this pitfall in redux-saga: If a saga uses a try with a finally block, that finally block should ideally not yield effects. Otherwise, the following error can happen: If the calling saga is cancelled, the inner finally-block is executed. The yielded effect will then resume the calling saga which is most likely not desired. There are two options to avoid this: a) Don't yield effects in finally blocks in sagas OR b) Ensure that the saga that contains the finally-block is called with `yield* call(saga)`  (instead of `yield* saga()`). Additional context can be found here: https://github.com/scalableminds/webknossos/pull/10267.

## Backend 
- the backend uses Scala, sbt and the Play framework

Code Verification: 
- Scala type-checking: `sbt --client compile`. This will also compile the subprojects it depends on.
- Unit tests: `yarn test-backend`
- Formatting: `yarn fix-backend`


## Pull Requests
- run all the appropriate checks above
- use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`
- keep your summaries short and to the point


# Scripting & Command Permissions
- Never ever use `rm` commands on OSX platforms. Instead use the safer `trash` command. This prevents accidental permanent deletion.
