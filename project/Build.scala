import sbt._
import Keys._
import play.Project._

object Dependencies{
  val akkaVersion = "2.2.0"
  val reactiveVersion = "0.10.0"
  val reactivePlayVersion = "0.10.2"
  val braingamesVersion = "2.0.4"

  val restFb = "com.restfb" % "restfb" % "1.6.11"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  val akkaAgent = "com.typesafe.akka" %% "akka-agent" % akkaVersion
  val akkaRemote = "com.typesafe.akka" %% "akka-remote" % akkaVersion
  // Jira integration
  val jerseyClient = "com.sun.jersey" % "jersey-client" % "1.8"
  val jerseyCore = "com.sun.jersey" % "jersey-core" % "1.8"
  val reactivePlay = "org.reactivemongo" %% "play2-reactivemongo" % reactivePlayVersion
  val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson-macros" % reactiveVersion
  val scalaReflect = "org.scala-lang" % "scala-reflect" % "2.10.0"
  val braingamesBinary = "com.scalableminds" %% "braingames-binary" % braingamesVersion
  val braingamesUtil = "com.scalableminds" %% "braingames-util" % braingamesVersion
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.0-M2"
  val airbrake = "eu.teamon" %% "play-airbrake" % "0.3.5-SCM"
  val mongev = "com.scalableminds" %% "play-mongev" % "0.2.4"
}

object Resolvers {
  val novusRel = "repo.novus rels" at "http://repo.novus.com/releases/"
  val novuesSnaps = "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  val sonaRels = "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/"
  val sonaSnaps = "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/"
  val sgSnaps = "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/"
  val manSnaps = "mandubian" at "https://github.com/mandubian/mandubian-mvn/raw/master/snapshots/"
  val typesafeRel = "typesafe" at "http://repo.typesafe.com/typesafe/releases"
  val scmRel = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmIntRel = Resolver.sftp("scm.io intern releases repo", "scm.io", 44144, "/srv/maven/releases/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
  val scmIntSnaps = Resolver.sftp("scm.io intern snapshots repo", "scm.io", 44144, "/srv/maven/snapshots/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
}

object ApplicationBuild extends Build {
  import Dependencies._
  import Resolvers._

  val coffeeCmd = 
    if(System.getProperty("os.name").startsWith("Windows")) 
      "cmd /C coffee -p"
    else
      "coffee -p"

  val appName =  "oxalis"
  val appVersion = scala.io.Source.fromFile("version").mkString.trim

  val oxalisDependencies = Seq(
    restFb,
    commonsIo,
    commonsEmail,
    commonsLang,
    akkaTest,
    akkaAgent,
    akkaRemote,
    jerseyClient,
    jerseyCore,
    reactiveBson,
    reactivePlay,
    scalaReflect,
    braingamesUtil,
    braingamesBinary,
    scalaAsync,
    cache,
    airbrake,
    mongev)

  val dependencyResolvers = Seq(
    novusRel,
    novuesSnaps,
    sonaRels,
    sonaSnaps,
    sgSnaps,
    manSnaps,
    typesafeRel,
    scmRel,
    scmIntRel,
    scmIntSnaps,
    teamon
  )

  val isoshaderDependencies = Seq()

  lazy val dataStoreDependencies = Seq(
    scalaReflect,
    jerseyCore,
    jerseyClient,
    akkaRemote)

  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies).settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    scalaVersion := "2.10.3",
    //requireJs := Seq("main"),
    //requireJsShim += "main.js",
    resolvers ++= dependencyResolvers,
    lessEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    coffeescriptEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    javascriptEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    unmanagedBase <<= target(_ / "assets")
    // playAssetsDirectories += baseDirectory.value / "target" / "assets"
  )

  lazy val datastore: Project = Project("datastore", file("modules") / "datastore", dependencies = Seq(oxalis)).settings(
    libraryDependencies ++= dataStoreDependencies,
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd),
    scalaVersion := "2.10.3"
  ).aggregate(oxalis)

  lazy val isoshader = play.Project("isoshader", "0.1", isoshaderDependencies, path = file("modules") / "isoshader").settings(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    resolvers ++= dependencyResolvers,
    coffeescriptOptions := Seq("native", coffeeCmd)
  ).dependsOn(oxalis).aggregate(oxalis)
}
            
