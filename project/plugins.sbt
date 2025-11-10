// play framework
addSbtPlugin("org.playframework" % "sbt-plugin" % "3.0.9")

// buildinfo routes
addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.13.1")

// protocol buffers
addSbtPlugin("com.thesamet" % "sbt-protoc" % "1.0.8")

// scala formatter
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.5")

// scala linter
addSbtPlugin("com.sksamuel.scapegoat" %% "sbt-scapegoat" % "1.2.13")

// check dependencies against published vulnerabilities with sbt dependencyCheck
addSbtPlugin("net.nmoncho" % "sbt-dependency-check" % "1.8.1")

// protocol buffers
libraryDependencies += "com.thesamet.scalapb" %% "compilerplugin" % "0.11.20"

// java native interface
addSbtPlugin("com.github.sbt" % "sbt-jni" % "1.7.1")
