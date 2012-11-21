import sbt._
import Keys._

import PlayProject._

object ApplicationBuild extends Build {

  val appName = "oxalis"
  val appVersion = "0.1"
  val appDependencies = Seq(
    "org.mongodb" %% "casbah" % "2.4.0",
    "com.novus" %% "salat" % "1.9.1",
    "com.restfb" % "restfb" % "1.6.9",
    "org.apache.commons" % "commons-email" % "1.2",
    "com.typesafe.akka" % "akka-testkit" % "2.0",
    "com.typesafe.akka" % "akka-agent" % "2.0",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8"
  )
  val main = PlayProject(appName, appVersion, appDependencies, mainLang = SCALA).settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    incrementalAssetsCompilation:=true
  )

}
            
