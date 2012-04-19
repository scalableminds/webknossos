import sbt._
import Keys._

import PlayProject._

object ApplicationBuild extends Build {

  val appName = "brainflight"
  val appVersion = "0.2"
  val appDependencies = Seq(
    "com.mongodb.casbah" % "casbah_2.9.1" % "2.1.5-1",
    "com.novus" %% "salat-core" % "0.0.8-SNAPSHOT",
    "com.restfb" % "restfb" % "1.6.9",
    "org.apache.commons" % "commons-email" % "1.2",
    "com.typesafe.akka" % "akka-testkit" % "2.0"
  )
  val main = PlayProject(appName, appVersion, appDependencies, mainLang = SCALA).settings(
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  )

}
            
