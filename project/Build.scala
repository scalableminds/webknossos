import sbt._
import Keys._

import PlayProject._

object ApplicationBuild extends Build {

  val appName = "oxalis"
  val appVersion = "0.1"

  val oxalisDependencies = Seq(
    "org.mongodb" %% "casbah" % "2.4.0",
    "com.novus" %% "salat" % "1.9.1",
    "com.restfb" % "restfb" % "1.6.9",
    "org.apache.commons" % "commons-email" % "1.2",
    "commons-io" % "commons-io" % "1.3.2",
    "com.typesafe.akka" % "akka-testkit" % "2.0",
    "com.typesafe.akka" % "akka-agent" % "2.0",
    "com.typesafe.akka" % "akka-remote" % "2.0",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "reactivemongo" %% "reactivemongo" % "0.1-SNAPSHOT")

  val shellgameDependencies = Seq()
  
  lazy val dataStoreDependencies = Seq(
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "com.typesafe.akka" % "akka-remote" % "2.0") 
  
  lazy val oxalis: Project = PlayProject(appName, appVersion, oxalisDependencies, mainLang = SCALA).settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    resolvers += "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/",
    playAssetsDirectories += file("data"),
    incrementalAssetsCompilation:=true
  )

  lazy val shellgame = PlayProject("shellgame", "0.1", shellgameDependencies, mainLang = SCALA, path = file("modules") / "shellgame").settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    playAssetsDirectories ++= Seq(
        file("modules") / "shellgame" / "shellgame-assets",
        file("data")
    ),
    incrementalAssetsCompilation:=true
  ).dependsOn(oxalis).aggregate(oxalis)

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  ).aggregate(oxalis)
}
            
