import sbt._
import Keys._
import com.typesafe.config._
import PlayProject._

object ApplicationBuild extends Build {
  val coffeeCmd = 
    if(System.getProperty("os.name").startsWith("Windows")) 
      "cmd /C coffee -p"
    else
      "coffee -p"

  val conf = ConfigFactory.parseFile(new File("conf/application.conf"))

  val appName = conf.getString("application.name").toLowerCase
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
    "commons-io" % "commons-io" % "1.3.2",
    "com.typesafe.akka" %% "akka-testkit" % "2.1.0",
    "com.typesafe.akka" %% "akka-agent" % "2.1.0",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "org.reactivemongo" %% "play2-reactivemongo" % "0.9",
    "org.reactivemongo" %% "reactivemongo-bson-macros" % "0.9",
    "org.scala-lang" % "scala-reflect" % "2.10.0")

  val dependencyResolvers = Seq(
    "repo.novus rels" at "http://repo.novus.com/releases/",
    "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/",
    "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/",
    "mandubian" at "https://github.com/mandubian/mandubian-mvn/raw/master/snapshots/",
    "typesafe" at "http://repo.typesafe.com/typesafe/releases",
    Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  )

  val stackrendererDependencies = Seq(
    "org.kamranzafar" % "jtar" % "2.2",
    "com.amazonaws" % "aws-java-sdk" % "1.3.32")

  val isoshaderDependencies = Seq()

  lazy val dataStoreDependencies = Seq(
    "org.scala-lang" % "scala-reflect" % "2.10.0",
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0")

  lazy val levelcreatorDependencies = Seq(
    "org.reactivemongo" %% "reactivemongo-bson-macros" % "0.9",
    "org.reactivemongo" %% "play2-reactivemongo" % "0.9"
  )

  lazy val braingamesDependencies = Seq(
    "play" %% "play" % "2.1.2-SCM",
    "commons-io" % "commons-io" % "1.3.2",
    "org.reactivemongo" %% "reactivemongo-bson-macros" % "0.9",
    "org.reactivemongo" %% "play2-reactivemongo" % "0.9",
    "com.typesafe.akka" %% "akka-agent" % "2.1.0",
    "org.apache.commons" % "commons-email" % "1.3.1",
    "org.apache.commons" % "commons-lang3" % "3.1",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0")

  lazy val braingamesUtil: Project = Project("braingames-util", file("modules") / "braingames-util").settings(
    libraryDependencies ++= braingamesDependencies,
    resolvers ++= dependencyResolvers,
    organization := "com.scalableminds",
    scalaVersion := "2.10.0",
    offline := true,
    version := "0.2"
  )

  lazy val braingamesBinary: Project = Project("braingames-binary", file("modules") / "braingames-binary").settings(
    libraryDependencies ++= braingamesDependencies,
    resolvers ++= dependencyResolvers,
    scalaVersion := "2.10.0",
    offline := true
  ).dependsOn(braingamesUtil).aggregate(braingamesUtil)

  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies).settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    coffeescriptOptions := Seq(/*"minify",*/ "native", coffeeCmd),
    //requireJs := Seq("main"),
    //requireJsShim += "main.js",
    resolvers ++= dependencyResolvers,
    offline := true
    //playAssetsDirectories += file("data")
  ).dependsOn(braingamesUtil, braingamesBinary).aggregate(braingamesUtil, braingamesBinary)

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd),
    scalaVersion := "2.10.0"
  ).aggregate(oxalis)

  lazy val levelcreator = play.Project("levelcreator", "0.1", levelcreatorDependencies, path = file("modules") / "levelcreator").settings(
    resolvers ++= dependencyResolvers,
    // offline := true,
    coffeescriptOptions := Seq("native", coffeeCmd)
  ).dependsOn(braingamesUtil, braingamesBinary).aggregate(braingamesUtil, braingamesBinary)

  lazy val stackrenderer = play.Project("stackrenderer", "0.1", stackrendererDependencies, path = file("modules") / "stackrenderer").settings(
    resolvers ++= dependencyResolvers
  ).dependsOn(braingamesUtil, braingamesBinary, oxalis, levelcreator).aggregate(braingamesUtil, braingamesBinary, oxalis, levelcreator)

  lazy val isoshader = play.Project("isoshader", "0.1", isoshaderDependencies, path = file("modules") / "isoshader").settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd)
  ).dependsOn(oxalis).aggregate(oxalis)
}
            
