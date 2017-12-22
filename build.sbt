import play.routes.compiler.InjectedRoutesGenerator
import play.sbt.routes.RoutesKeys.routesGenerator
import sbt._
import sbtassembly.PathList

val wkVersion = scala.io.Source.fromFile("version").mkString.trim

name := "oxalis"

version := wkVersion

scalaVersion in ThisBuild := "2.11.8"


lazy val webknossosSettings = Seq(
  TwirlKeys.templateImports += "oxalis.view.helpers._",
  TwirlKeys.templateImports += "oxalis.view._",
  scalacOptions += "-target:jvm-1.8",
  routesGenerator := InjectedRoutesGenerator,
  libraryDependencies ++= Dependencies.webknossosDependencies,
  resolvers ++= DependencyResolvers.dependencyResolvers,
  sourceDirectory in Assets := file("none"),
  updateOptions := updateOptions.value.withLatestSnapshots(true),
  unmanagedJars in Compile ++= {
    val libs = baseDirectory.value / "lib"
    val subs = (libs ** "*") filter { _.isDirectory }
    val targets = ( (subs / "target") ** "*" ) filter {f => f.name.startsWith("scala-") && f.isDirectory}
    ((libs +++ subs +++ targets) ** "*.jar").classpath
  }
)


lazy val standaloneDatastoreSettings = Seq(
  libraryDependencies ++= Dependencies.standaloneDatastoreDependencies,
  resolvers ++= DependencyResolvers.dependencyResolvers,
  routesGenerator := InjectedRoutesGenerator,
  version := "wk-" + wkVersion,
  assemblyMergeStrategy in assembly := {
    case "application.conf"                                                  => MergeStrategy.concat
    case "package-info.class"                                                => MergeStrategy.concat
    case PathList(ps @ _*) if ps.last endsWith "package-info.class"          => MergeStrategy.discard
    case PathList(ps @ _*) if ps.last endsWith "pom.properties"              => MergeStrategy.concat
    case PathList(ps @ _*) if ps.last endsWith "pom.xml"                     => MergeStrategy.discard
    case PathList(ps @ _*) if ps.last endsWith "log4j-provider.properties"   => MergeStrategy.last
    case PathList(ps @ _*) if ps.last endsWith "newrelic.yml"                => MergeStrategy.last
    case x if x.startsWith("META-INF/ECLIPSEF.RSA")                          => MergeStrategy.last
    case x if x.startsWith("META-INF/mailcap")                               => MergeStrategy.last
    case x if x.startsWith("META-INF/mimetypes.default")                     => MergeStrategy.last
    case x if x.startsWith("plugin.properties")                              => MergeStrategy.last
    case PathList("javax", "servlet", xs @ _*)                               => MergeStrategy.first
    case PathList("javax", "transaction", xs @ _*)                           => MergeStrategy.first
    case PathList("javax", "mail", xs @ _*)                                  => MergeStrategy.first
    case PathList("javax", "activation", xs @ _*)                            => MergeStrategy.first
    case PathList(ps @ _*) if ps.last endsWith ".html"                       => MergeStrategy.first
    case PathList("org", "apache", "commons", "logging", xs @ _*)            => MergeStrategy.first
    case PathList("play", "core", "server", xs @ _*)                         => MergeStrategy.first
    case "log4j.properties"                                                  => MergeStrategy.concat
    case "unwanted.txt"                                                      => MergeStrategy.discard
    case x =>
      val oldStrategy = (assemblyMergeStrategy in assembly).value
      oldStrategy(x)
  }
)


val protocolBufferSettings = Seq(
  ProtocPlugin.autoImport.PB.targets in Compile := Seq(
    scalapb.gen() -> new java.io.File((sourceManaged in Compile).value + "/proto")
  ),
  ProtocPlugin.autoImport.PB.protoSources := Seq(new java.io.File("braingames-datastore/proto")))


lazy val util = (project in file("util"))
  .settings(Seq(
    resolvers ++= DependencyResolvers.dependencyResolvers,
    libraryDependencies ++= Dependencies.utilDependencies
  ))

lazy val braingamesBinary = (project in file("braingames-binary"))
  .dependsOn(util)
  .settings(Seq(
    resolvers ++= DependencyResolvers.dependencyResolvers,
    libraryDependencies ++= Dependencies.braingamesBinaryDependencies
  ))

lazy val braingamesDatastore = (project in file("braingames-datastore"))
  .dependsOn(util, braingamesBinary)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(protocolBufferSettings)
  .settings(Seq(
    resolvers ++= DependencyResolvers.dependencyResolvers,
    libraryDependencies ++= Dependencies.braingamesDatastoreDependencies,
    routesGenerator := InjectedRoutesGenerator
  ))


lazy val standaloneDatastore = (project in file("standalone-datastore"))
  .dependsOn(braingamesDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings((standaloneDatastoreSettings ++ BuildInfoSettings.standaloneDatastoreBuildInfoSettings):_*)

lazy val webknossos = (project in file("."))
  .dependsOn(util, braingamesBinary, braingamesDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings((webknossosSettings ++ AssetCompilation.settings ++ BuildInfoSettings.webknossosBuildInfoSettings):_*)



lazy val assemblyStandaloneDatastore = inputKey[Unit]("assembly standaloneDatastore")
assemblyStandaloneDatastore := assembly.all(ScopeFilter(inProjects(standaloneDatastore))).value.head
