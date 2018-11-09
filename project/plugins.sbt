addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "2.6.18")

addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.9.0")

addSbtPlugin("com.thesamet" % "sbt-protoc" % "0.99.18")

addSbtPlugin("io.get-coursier" % "sbt-coursier" % "1.0.3")

addSbtPlugin("com.geirsson" % "sbt-scalafmt" % "1.5.1")

addSbtPlugin("com.sksamuel.scapegoat" %% "sbt-scapegoat" % "1.0.9")

libraryDependencies += "com.thesamet.scalapb" %% "compilerplugin" % "0.8.0"
