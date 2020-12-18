import play.routes.compiler.InjectedRoutesGenerator
import play.sbt.routes.RoutesKeys.{routesGenerator, routesImport}
import sbt._

ThisBuild / version := "wk"
ThisBuild / scalaVersion := "2.12.12"
ThisBuild / scapegoatVersion := "1.3.8"
ThisBuild / scalacOptions ++= Seq(
  "-Xmax-classfile-name",
  "100",
  "-target:jvm-1.8",
  "-feature",
  "-deprecation",
  "-language:implicitConversions",
  "-language:postfixOps",
  "-Xlint:unused",
 s"-P:silencer:sourceRoots=${baseDirectory.value.getCanonicalPath}",
  "-P:silencer:pathFilters=(.*target/.*/routes/.*/(ReverseRoutes\\.scala|Routes\\.scala|routes\\.java|JavaScriptReverseRoutes.scala)|.*target/.*\\.template\\.scala)"
)

ThisBuild / routesImport := Seq.empty

ThisBuild / libraryDependencies ++= Seq(
  compilerPlugin("com.github.ghik" % "silencer-plugin" % "1.7.0" cross CrossVersion.full),
  "com.github.ghik" % "silencer-lib" % "1.7.0" % Provided cross CrossVersion.full
)

PlayKeys.devSettings := Seq("play.server.akka.requestTimeout" -> "10000s", "play.server.http.idleTimeout" -> "10000s")

scapegoatIgnoredFiles := Seq(".*/Tables.scala",
                             ".*/Routes.scala",
                             ".*/ReverseRoutes.scala",
                             ".*/JavaScriptReverseRoutes.scala",
                             ".*/.*mail.*template\\.scala")
scapegoatDisabledInspections := Seq("FinalModifierOnCaseClass", "UnusedMethodParameter")

lazy val commonSettings = Seq(
  resolvers ++= DependencyResolvers.dependencyResolvers,
  sources in (Compile, doc) := Seq.empty,
  publishArtifact in (Compile, packageDoc) := false
)

lazy val protocolBufferSettings = Seq(
  ProtocPlugin.autoImport.PB.targets in Compile := Seq(
    scalapb.gen() -> new java.io.File((sourceManaged in Compile).value + "/proto")
  ),
  ProtocPlugin.autoImport.PB.protoSources := Seq(new java.io.File("webknossos-tracingstore/proto"))
)

lazy val copyConfFilesSetting = {
  lazy val copyMessages = taskKey[Unit]("Copy messages file to data- and tracing stores")
  copyMessages := {
    val messagesFile = baseDirectory.value / ".." / "conf" / "messages"
    java.nio.file.Files.copy(messagesFile.toPath, (baseDirectory.value / "conf" / "messages").toPath)
  }
}

lazy val util = (project in file("util")).settings(
  commonSettings,
  libraryDependencies ++= Dependencies.utilDependencies
)

lazy val webknossosDatastore = (project in file("webknossos-datastore"))
  .dependsOn(util)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings(
    name := "webknossos-datastore",
    commonSettings,
    BuildInfoSettings.webknossosDatastoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosDatastoreDependencies,
    routesGenerator := InjectedRoutesGenerator,
    unmanagedJars in Compile ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ((subs / "target") ** "*") filter { f =>
        f.name.startsWith("scala-") && f.isDirectory
      }
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    },
    copyConfFilesSetting
  )

lazy val webknossosTracingstore = (project in file("webknossos-tracingstore"))
  .dependsOn(webknossosDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(
    name := "webknossos-tracingstore",
    commonSettings,
    BuildInfoSettings.webknossosTracingstoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosTracingstoreDependencies,
    protocolBufferSettings,
    routesGenerator := InjectedRoutesGenerator,
    copyConfFilesSetting
  )

lazy val webknossos = (project in file("."))
  .dependsOn(util, webknossosTracingstore)
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
      val targets = ((subs / "target") ** "*") filter { f =>
        f.name.startsWith("scala-") && f.isDirectory
      }
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    }
  )
