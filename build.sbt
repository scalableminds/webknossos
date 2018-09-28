import play.routes.compiler.InjectedRoutesGenerator
import play.sbt.routes.RoutesKeys.routesGenerator
import sbt._

name := "webknossos"

scalaVersion in ThisBuild := "2.11.8"

version := "wk"

scalacOptions in ThisBuild ++= Seq(
  "-target:jvm-1.8",
  "-feature",
  "-deprecation",
  "-language:implicitConversions",
  "-language:postfixOps"
)

lazy val webknossosSettings = Seq(
  TwirlKeys.templateImports += "oxalis.view.helpers._",
  TwirlKeys.templateImports += "oxalis.view._",
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


lazy val webknossosDatastoreSettings = Seq(
  libraryDependencies ++= Dependencies.webknossosDatastoreDependencies,
  resolvers ++= DependencyResolvers.dependencyResolvers,
  routesGenerator := InjectedRoutesGenerator,
  name := "webknossos-datastore",
  version := "wk"
)

lazy val webknossosTracingstoreSettings = Seq(
  libraryDependencies ++= Dependencies.webknossosTracingstoreDependencies,
  resolvers ++= DependencyResolvers.dependencyResolvers,
  routesGenerator := InjectedRoutesGenerator,
  name := "webknossos-tracingstore",
  version := "wk"
)

val protocolBufferSettings = Seq(
  ProtocPlugin.autoImport.PB.targets in Compile := Seq(
    scalapb.gen() -> new java.io.File((sourceManaged in Compile).value + "/proto")
  ),
  ProtocPlugin.autoImport.PB.protoSources := Seq(new java.io.File("webknossos-tracingstore/proto")))

lazy val util = (project in file("util"))
  .settings(Seq(
    resolvers ++= DependencyResolvers.dependencyResolvers,
    libraryDependencies ++= Dependencies.utilDependencies
  ))

lazy val webknossosDatastore = (project in file("webknossos-datastore"))
  .dependsOn(util)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(protocolBufferSettings)
  .settings((webknossosDatastoreSettings ++ BuildInfoSettings.webknossosDatastoreBuildInfoSettings):_*)

lazy val webknossosTracingstore = (project in file("webknossos-tracingstore"))
  .dependsOn(webknossosDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(protocolBufferSettings)
  .settings((webknossosTracingstoreSettings ++ BuildInfoSettings.webknossosTracingstoreBuildInfoSettings):_*)

lazy val webknossos = (project in file("."))
  .dependsOn(util, webknossosTracingstore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings((webknossosSettings ++ AssetCompilation.settings ++ BuildInfoSettings.webknossosBuildInfoSettings):_*)
