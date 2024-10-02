// play framework
addSbtPlugin("org.playframework" % "sbt-plugin" % "3.0.5")

// buildinfo routes
addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.11.0")

// protocol buffers
addSbtPlugin("com.thesamet" % "sbt-protoc" % "1.0.7")

// scala formatter
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.2")

// scala linter
addSbtPlugin("com.sksamuel.scapegoat" %% "sbt-scapegoat" % "1.2.4")

// check dependencies against published vulnerabilities with sbt dependencyCheck
addSbtPlugin("net.vonbuchholtz" % "sbt-dependency-check" % "5.1.0")

// protocol buffers
libraryDependencies += "com.thesamet.scalapb" %% "compilerplugin" % "0.11.17"

// java native interface
addSbtPlugin("com.github.sbt" % "sbt-jni" % "1.7.1")
