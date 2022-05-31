import play.routes.compiler.InjectedRoutesGenerator
import play.sbt.routes.RoutesKeys.routesGenerator
import sbt._

ThisBuild / version := "wk"
ThisBuild / scalaVersion := "2.12.15"
ThisBuild / scapegoatVersion := "1.4.10"
ThisBuild / scalacOptions ++= Seq(
  "-Xmax-classfile-name",
  "100",
  "-target:jvm-1.8",
  "-feature",
  "-deprecation",
  "-language:implicitConversions",
  "-language:postfixOps",
  "-Xlint:unused",
  s"-Wconf:src=target/.*:s",
  s"-Wconf:src=webknossos-datastore/target/.*:s",
  s"-Wconf:src=webknossos-tracingstore/target/.*:s"
)

ThisBuild / dependencyCheckAssemblyAnalyzerEnabled := Some(false)

PlayKeys.devSettings := Seq("play.server.akka.requestTimeout" -> "10000s", "play.server.http.idleTimeout" -> "10000s")

scapegoatIgnoredFiles := Seq(".*/Tables.scala",
                             ".*/Routes.scala",
                             ".*/ReverseRoutes.scala",
                             ".*/JavaScriptReverseRoutes.scala",
                             ".*/.*mail.*template\\.scala")
scapegoatDisabledInspections := Seq("FinalModifierOnCaseClass", "UnusedMethodParameter", "UnsafeTraversableMethods")

lazy val commonSettings = Seq(
  resolvers ++= DependencyResolvers.dependencyResolvers,
  Compile / doc / sources := Seq.empty,
  Compile / packageDoc / publishArtifact := false
)

lazy val protocolBufferSettings = Seq(
  Compile / PB.protoSources := Seq(baseDirectory.value / "proto"),
  Compile / PB.targets := Seq(
    scalapb.gen() -> (Compile / sourceManaged).value / "proto"
  )
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
  .enablePlugins(ProtocPlugin)
  .settings(
    name := "webknossos-datastore",
    commonSettings,
    BuildInfoSettings.webknossosDatastoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosDatastoreDependencies,
    routesGenerator := InjectedRoutesGenerator,
    protocolBufferSettings,
    Compile / unmanagedJars ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ((subs / "target") ** "*") filter { f =>
        f.name.startsWith("scala-") && f.isDirectory
      }
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    },
    copyConfFilesSetting,
    assembly / assemblyMergeStrategy := {
      case PathList(ps @ _*) if ps.last endsWith ".class" => MergeStrategy.last
      case PathList(ps @ _*) if ps.last endsWith ".proto" => MergeStrategy.last
      case PathList(ps @ _*) if List("io.netty.versions.properties", "mailcap.default",
        "mimetypes.default", "native-image.properties").contains(ps.last) => MergeStrategy.last
      case PathList(ps @ _*) if List("application.conf", "reference-overrides.conf").contains(ps.last) => MergeStrategy.concat
      case x =>
        val oldStrategy = (assembly / assemblyMergeStrategy).value
        oldStrategy(x)
    },
    assembly / test := {},
    assembly / assemblyJarName := s"webknossos-datastore-${BuildInfoSettings.webKnossosVersion}.jar"
  )

lazy val webknossosTracingstore = (project in file("webknossos-tracingstore"))
  .dependsOn(webknossosDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings(
    name := "webknossos-tracingstore",
    commonSettings,
    BuildInfoSettings.webknossosTracingstoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosTracingstoreDependencies,
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
    Assets / sourceDirectory := file("none"),
    updateOptions := updateOptions.value.withLatestSnapshots(true),
    Compile / unmanagedJars ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ((subs / "target") ** "*") filter { f =>
        f.name.startsWith("scala-") && f.isDirectory
      }
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    }
  )
