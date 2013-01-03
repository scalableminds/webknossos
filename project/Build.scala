import sbt._
import Keys._

import PlayProject._

object ApplicationBuild extends Build {

  val appName = "oxalis"
  val appVersion = "0.1"

  val oxalisDependencies = Seq(
    "org.mongodb" % "casbah-commons_2.10" % "2.5.0-SNAPSHOT",
    "org.mongodb" % "casbah-core_2.10" % "2.5.0-SNAPSHOT",
    "org.mongodb" % "casbah-query_2.10" % "2.5.0-SNAPSHOT",
    "org.mongodb" % "casbah-gridfs_2.10" % "2.5.0-SNAPSHOT",
    "com.novus" % "salat-core_2.10" % "1.9.2-SNAPSHOT",
    "com.restfb" % "restfb" % "1.6.11",
    "commons-io" % "commons-io" % "1.3.2",
    "org.apache.commons" % "commons-email" % "1.2",
    "com.typesafe.akka" %  "akka-testkit_2.10.0-RC1" % "2.1.0-RC1",
    "com.typesafe.akka" % "akka-agent_2.10.0-RC1" % "2.1.0-RC1",
    "com.typesafe.akka" % "akka-remote_2.10.0-RC1" % "2.1.0-RC1",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "reactivemongo" % "reactivemongo_2.10.0-RC2" % "0.1-SNAPSHOT",
    "org.scala-lang" % "scala-reflect" % "2.10.0-RC1")

  val shellgameDependencies = Seq()
  
  lazy val dataStoreDependencies = Seq(
    "org.scala-lang" % "scala-reflect" % "2.10.0-RC1",
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "com.typesafe.akka" % "akka-remote_2.10.0-RC1" % "2.1.0-RC1") 
  
  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies).settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    resolvers += "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    resolvers += "sonatype rels" at "https://oss.sonatype.org/content/repositories/snapshots/",
    resolvers += "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/",
    playAssetsDirectories += file("data")
  )

  lazy val shellgame = play.Project("shellgame", "0.1", shellgameDependencies, path = file("modules") / "shellgame").settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    resolvers += "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    playAssetsDirectories ++= Seq(
        file("modules") / "shellgame" / "shellgame-assets",
        file("data")
    )
  ).dependsOn(oxalis).aggregate(oxalis)

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers += "repo.novus rels" at "http://repo.novus.com/releases/",
    resolvers += "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    resolvers += "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/",
    resolvers += "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    scalaVersion := "2.10.0-RC1"
  ).aggregate(oxalis)
}
            
