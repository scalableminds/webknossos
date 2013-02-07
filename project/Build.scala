import sbt._
import Keys._
import com.typesafe.config._
import PlayProject._

object ApplicationBuild extends Build {
  val conf = ConfigFactory.parseFile(new File("conf/application.conf"))

  val appName    = conf.getString("application.name").toLowerCase
  val appVersion = "%s.%s.%s".format(
    conf.getString("application.major"),
    conf.getString("application.minor"),
    conf.getString("application.revision"))

  val oxalisDependencies = Seq(
    "org.mongodb" %% "casbah-commons" % "2.5.0",
    "org.mongodb" %% "casbah-core" % "2.5.0",
    "org.mongodb" %% "casbah-query" % "2.5.0",
    "org.mongodb" %% "casbah-gridfs" % "2.5.0",
    "com.novus" %% "salat-core" % "1.9.2-SNAPSHOT",
    "com.restfb" % "restfb" % "1.6.11",
    "commons-io" % "commons-io" % "1.3.2",
    "org.apache.commons" % "commons-email" % "1.2",
    "com.typesafe.akka" %%  "akka-testkit" % "2.1.0",
    "com.typesafe.akka" %% "akka-agent" % "2.1.0",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "reactivemongo" % "reactivemongo_2.10.0" % "0.1-SNAPSHOT",
    "org.scala-lang" % "scala-reflect" % "2.10.0-RC1")

  val dependencyResolvers = Seq(
    "repo.novus rels" at "http://repo.novus.com/releases/",
    "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/",
    "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/"
  )
  val shellgameDependencies = Seq()
  
  val levelcreatorDependencies = Seq()
  
  val isoshaderDependencies = Seq()
  
  lazy val dataStoreDependencies = Seq(
    "org.scala-lang" % "scala-reflect" % "2.10.0",
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0") 
  
  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies).settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers ++= dependencyResolvers,
    //offline := true,
    playAssetsDirectories += file("data")
  )

  lazy val shellgame = play.Project("shellgame", "0.1", shellgameDependencies, path = file("modules") / "shellgame").settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers ++= dependencyResolvers,
    playAssetsDirectories ++= Seq(
        file("modules") / "shellgame" / "shellgame-assets",
        file("data")
    )
  ).dependsOn(oxalis).aggregate(oxalis)

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers ++= dependencyResolvers,
    scalaVersion := "2.10.0"
  ).aggregate(oxalis)
  
  lazy val levelcreator = play.Project("levelcreator", "0.1", levelcreatorDependencies, path = file("modules") / "levelcreator").settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers ++= dependencyResolvers,
    //offline := true,
    playAssetsDirectories += file("data")
  ).dependsOn(oxalis).aggregate(oxalis)
  
  lazy val isoshader = play.Project("isoshader", "0.1", isoshaderDependencies, path = file("modules") / "isoshader").settings(
    templatesImport += "brainflight.view.helpers._",
    templatesImport += "brainflight.view._",
    resolvers ++= dependencyResolvers,
    playAssetsDirectories += file("data")
  ).dependsOn(oxalis).aggregate(oxalis)
}
            
