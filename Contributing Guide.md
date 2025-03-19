# Contributing Guide

**Welcome to the WEBKNOSSOS contributing guide :sparkles: **

Thank you for taking the time to contribute to this project! The following is a set of guidelines for contributing to WEBKNOSSOS. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Code of Conduct

WEBKNOSSOS and everyone contributing and collaborating on this project is expected to follow the [WEBKNOSSOS Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to [hello@webknossos.org](mailto:hello@webknossos.org).


## How can I help?

We welcome community feedback and contributions! We are happy to have

* [general feedback, observations and questions](#feedback-observations-and-questions) on the [image.sc forum](https://forum.image.sc/tag/webknossos),
* [feature suggestions and bug reports](#issues-feature-suggestions-and-bug-reports) as [issues on GitHub](https://github.com/scalableminds/webknossos/issues/new),
* [documentation, examples and code contributions](#pull-requests-docs-and-code-contributions) as [pull requests on GitHub](https://github.com/scalableminds/webknossos/compare).


## Feedback, Observations and Questions

We'd love to hear your feedback on the WEBKNOSSOS!
We're also interested in hearing if this tool don't work for your usecase,
or if you have questions regarding its usage.

Please leave a message on the [image.sc forum](https://forum.image.sc/tag/webknossos)
using the `webknossos` tag to enable public communication on those topics.
If you prefer to share information only with the WEBKNOSSOS team, please write an email
to [hello@webknossos.org](mailto:hello@webknossos.org). For commercial support please
reach out to [scalable minds](https://scalableminds.com).


## Issues: Feature Suggestions and Bug Reports

We track feature requests and bug reports in the [WEBKNOSSOS repository issues](https://github.com/scalableminds/webknossos/issues).
Before opening a new issue, please do a quick search of existing issues to make sure your suggestion hasn’t already been added.
If your issue doesn’t already exist, and you’re ready to create a new one, make sure to state what you would like to implement, improve or bugfix.
Please use one of the provided templates to make this process easier for you.

You can submit an issue [here](https://github.com/scalableminds/webknossos/issues/new)
(read more about [issues here](https://docs.github.com/en/issues)).


### Report a Bug :lady_beetle:

When you find a bug, please double-check if an issue for the same bug exists already.
If that's not the case, please verify in the [documentation](https://docs.webknossos.org/)
that you use the API as intended. If that's the case, please
[add an issue using the bug report template](https://github.com/scalableminds/webknossos/issues/new?template=bug_report.md).


### Suggest a New Feature

If you are missing a feature to support your use-case, please consider the following points:

1. Please verify if this feature is directly related to WEBKNOSSOS.
   Does it belong into the WEBKNOSSOS?
2. Double-check if an issue for this feature exists already. If there is one with a very similar scope,
   please considering commenting there.
3. If possible, consider how the implementation might look like (e.g. how would the public API change),
   as well as how this could be tested and presented in the examples.

Then, please [add an issue using the feature suggestion template](https://github.com/scalableminds/webknossos/issues/new?template=feature_request.md).


## Pull Requests: Docs and Code Contributions

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla-assistant.io/scalableminds/webknossos.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once using our CLA.

If you want to fix a minor problem in the documentation, examples or other code, feel free to
[open a pull requests for it on GitHub](https://github.com/scalableminds/webknossos/compare)
(read more about [pull requests here](https://docs.github.com/en/pull-requests).

For larger features and changes, we prefer that you open a new issue before creating a pull request.
Please include the following in your pull request:

* The pull request description should explain what you've done.
* Add tests for the new features.
* Comply with the coding styles.
* Adapt or add the documentation.
* Consider enhancing the examples.

The specific coding styles, test frameworks and documentation setup of WEBKNOSSOS are described
in the following sections:


### Development

The [webknossos repository](https://github.com/scalableminds/webknossos) is structured in frontend and backend parts with different tooling.

* **Frontend Tooling** We enforce coding styles and require all unit and integration tests to pass:
    * `yarn fix-frontend`: Code formatting and linting with biome
    * `yarn typecheck`: Code type checking with Typescript
    * `yarn test`: Unit tests with ava
    * `yarn test-e2e`: End-to-end, integration tests

    See `package.json` for more `yarn <command>` shortcuts.

* **CI** We use continuous integration with [GitHub actions](https://github.com/scalableminds/webknossos/actions), please see the `CI` workflow for details.


### Documentation

We render a combined documentation for WEBKNOSSOS itself and the WEBKNOSSOS Python libraries from the webknossos-libs repository using [mkdocs](https://www.mkdocs.org/). Source-files for the documentation are stored in the `docs` directory.

The documentation is deploy automatically through GitHub actions from the [WEBKNOSSOS Python libraries repository](https://github.com/scalableminds/webknossos-libs/actions).