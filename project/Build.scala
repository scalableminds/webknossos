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
    "com.novus" %% "salat-core" % "1.9.2",
    "com.restfb" % "restfb" % "1.6.11",
    "commons-io" % "commons-io" % "2.4",
    "org.apache.commons" % "commons-email" % "1.3.1",
    "org.apache.commons" % "commons-lang3" % "3.1",
    "com.typesafe.akka" %% "akka-testkit" % "2.1.0",
    "com.typesafe.akka" %% "akka-agent" % "2.1.0",
    "com.typesafe.akka" %% "akka-remote" % "2.1.0",
    // Jira integration
    "com.sun.jersey" % "jersey-client" % "1.8",
    "com.sun.jersey" % "jersey-core" % "1.8",
    "org.reactivemongo" %% "play2-reactivemongo" % "0.9",
    "org.reactivemongo" %% "reactivemongo-bson-macros" % "0.9",
    "org.scala-lang" % "scala-reflect" % "2.10.0",
    "com.scalableminds" %% "braingames-binary" % "0.3.5",
    "com.scalableminds" %% "braingames-util" % "0.3.5")

  val dependencyResolvers = Seq(
    "repo.novus rels" at "http://repo.novus.com/releases/",
    "repo.novus snaps" at "http://repo.novus.com/snapshots/",
    "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/",
    "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/",
    "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/",
    "mandubian" at "https://github.com/mandubian/mandubian-mvn/raw/master/snapshots/",
    "typesafe" at "http://repo.typesafe.com/typesafe/releases",
    Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns),
    Resolver.sftp("scm.io intern releases repo", "scm.io", 44144, "/srv/maven/releases/") as("maven", "5MwEuHWH6tRPL6yfNadQ"),
    Resolver.sftp("scm.io intern snapshots repo", "scm.io", 44144, "/srv/maven/snapshots/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
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
    "org.reactivemongo" %% "play2-reactivemongo" % "0.9",
    "com.scalableminds" %% "braingames-binary" % "0.3.5",
    "com.scalableminds" %% "braingames-util" % "0.3.5",
    "commons-io" % "commons-io" % "2.4",
    "com.typesafe.akka" %% "akka-agent" % "2.1.0")

  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies).settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    coffeescriptOptions := Seq(/*"minify",*/ "native", coffeeCmd),
    scalaVersion := "2.10.2",
    //requireJs := Seq("main"),
    //requireJsShim += "main.js",
    resolvers ++= dependencyResolvers,
    offline := true
    //playAssetsDirectories += file("data")
  )

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd),
    scalaVersion := "2.10.2"
  ).aggregate(oxalis)

  lazy val levelcreator = play.Project("levelcreator", "0.1", levelcreatorDependencies, path = file("modules") / "levelcreator").settings(
    resolvers ++= dependencyResolvers,
    // offline := true,
    coffeescriptOptions := Seq("native", coffeeCmd)
  )

  lazy val stackrenderer = play.Project("stackrenderer", "0.1", stackrendererDependencies, path = file("modules") / "stackrenderer").settings(
    resolvers ++= dependencyResolvers
  ).dependsOn(oxalis, levelcreator).aggregate(oxalis, levelcreator)

  lazy val isoshader = play.Project("isoshader", "0.1", isoshaderDependencies, path = file("modules") / "isoshader").settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd)
  ).dependsOn(oxalis).aggregate(oxalis)
}
            
