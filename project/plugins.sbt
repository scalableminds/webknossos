// play framework
addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "2.8.8")

// buildinfo routes
addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.9.0")

// protocol buffers
addSbtPlugin("com.thesamet" % "sbt-protoc" % "1.0.2")

// auto-fetch dependencies
addSbtPlugin("io.get-coursier" % "sbt-coursier" % "1.0.3")

// scala formatter
addSbtPlugin("com.geirsson" % "sbt-scalafmt" % "1.5.1")

// scala linter
addSbtPlugin("com.sksamuel.scapegoat" %% "sbt-scapegoat" % "1.1.1")

// check dependencies against published vulnerabilities with sbt dependencyCheck
addSbtPlugin("net.vonbuchholtz" % "sbt-dependency-check" % "3.1.3")

//protocol buffers
libraryDependencies += "com.thesamet.scalapb" %% "compilerplugin" % "0.11.3"
