import play.routes.compiler.InjectedRoutesGenerator
import play.sbt.routes.RoutesKeys.routesGenerator
import sbt._

ThisBuild / version := "wk"
ThisBuild / scalaVersion := "2.12.7"
ThisBuild / scalacOptions ++= Seq(
  "-Xmax-classfile-name","100",
  "-target:jvm-1.8",
  "-feature",
  "-deprecation",
  "-language:implicitConversions",
  "-language:postfixOps"
)

lazy val commonSettings = Seq(
  resolvers ++= DependencyResolvers.dependencyResolvers,
  sources in (Compile, doc) := Seq.empty,
  publishArtifact in (Compile, packageDoc) := false
)

lazy val protocolBufferSettings = Seq(
  ProtocPlugin.autoImport.PB.targets in Compile := Seq(
    scalapb.gen() -> new java.io.File((sourceManaged in Compile).value + "/proto")
  ),
  ProtocPlugin.autoImport.PB.protoSources := Seq(new java.io.File("webknossos-datastore/proto")))

lazy val util = (project in file("util"))
  .settings(
    commonSettings,
    libraryDependencies ++= Dependencies.utilDependencies
  )

lazy val webknossosDatastore = (project in file("webknossos-datastore"))
  .dependsOn(util)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(
    name := "webknossos-datastore",
    commonSettings,
    protocolBufferSettings,
    BuildInfoSettings.webknossosDatastoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosDatastoreDependencies,
    routesGenerator := InjectedRoutesGenerator
  )

lazy val webknossos = (project in file("."))
  .dependsOn(util, webknossosDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings(
    name := "webknossos",
    commonSettings,
    AssetCompilation.settings,
    BuildInfoSettings.webknossosBuildInfoSettings,
    routesGenerator := InjectedRoutesGenerator,
    libraryDependencies ++= Dependencies.webknossosDependencies,
    sourceDirectory in Assets := file("none"),
    updateOptions := updateOptions.value.withLatestSnapshots(true),
    unmanagedJars in Compile ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ( (subs / "target") ** "*" ) filter {f => f.name.startsWith("scala-") && f.isDirectory}
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    }
  )
