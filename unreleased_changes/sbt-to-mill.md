### Changed
- The backend is now built with [Mill](https://mill-build.org/) instead of sbt, which starts faster. Run `./mill` instead of `sbt` (it downloads Mill and the JDK, see DEV_INSTALL.md); the yarn scripts keep their names. The build info (`/api/buildinfo`) now contains `millVersion` instead of `sbtVersion`.
