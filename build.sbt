import sbt._

ThisBuild / version := "wk"
scalaVersion := "3.6.3"
ThisBuild / scalaVersion := "3.6.3"
// ThisBuild / scalaVersion := "2.13.14"
// crossScalaVersions ++= Seq("2.13.11", "3.3.4")
// ThisBuild / scapegoatVersion := "2.1.6"
ThisBuild / scalafixDependencies += "io.github.dedis" %% "scapegoat-scalafix" % "1.1.4"
inThisBuild(
  List(
    semanticdbEnabled := true,
    semanticdbVersion := scalafixSemanticdb.revision
  )
)

// fix jni for scala version 3
sbtJniCoreScope := Compile
val failOnWarning = if (sys.props.contains("failOnWarning")) Seq("-Xfatal-warnings") else Seq()
ThisBuild / scalacOptions ++= Seq(
  "-explain", // More detailed compiler output
  // "-Xcheck-null",  // Additional null checks are no longer supported in Scala 3
  "-explain-types", // Explain type errors in detail
  // "-rewrite",
  // "-source:3.4-migration",
  "-release:11",
  "-feature",
  "-deprecation",
  "-language:implicitConversions",
  "-language:postfixOps",
  "-Wconf:src=target/.*:s",
  "-Wconf:src=webknossos-datastore/target/.*:s",
  "-Wconf:src=webknossos-tracingstore/target/.*:s"
) ++ failOnWarning
ThisBuild / javacOptions ++= Seq(
  "-Xlint:unchecked",
  "-Xlint:deprecation"
)
ThisBuild / dependencyCheckAssemblyAnalyzerEnabled := Some(false)

// Keep asset timestamps when assembling jar
ThisBuild / packageOptions += Package.FixedTimestamp(Package.keepTimestamps)

PlayKeys.devSettings := Seq("play.server.pekko.requestTimeout" -> "10000s", "play.server.http.idleTimeout" -> "10000s")

// Disable unused import warnings, only in sbt console REPL
Compile / console / scalacOptions -= "-Xlint:unused"

// scapegoatIgnoredFiles := Seq(".*/Tables.scala", ".*/Routes.scala", ".*/.*mail.*template\\.scala")
// scapegoatDisabledInspections := Seq("FinalModifierOnCaseClass", "UnusedMethodParameter", "UnsafeTraversableMethods")

// Allow path binding for ObjectId
routesImport += "com.scalableminds.util.objectid.ObjectId"

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

lazy val copyMessagesFilesSetting = {
  lazy val copyMessages = taskKey[Unit]("Copy messages file to data- and tracing stores")
  copyMessages := {
    val messagesFile = baseDirectory.value / ".." / "conf" / "messages"
    java.nio.file.Files.copy(messagesFile.toPath, (baseDirectory.value / "conf" / "messages").toPath)
  }
}

lazy val util = (project in file("util")).settings(
  commonSettings,
  libraryDependencies ++= Dependencies.utilDependencies,
  dependencyOverrides ++= Dependencies.dependencyOverrides
)

lazy val webknossosJni = (project in file("webknossos-jni"))
  .settings(nativeCompile / sourceDirectory := sourceDirectory.value)
  .enablePlugins(JniNative)

lazy val webknossosDatastore = (project in file("webknossos-datastore"))
  .dependsOn(util)
  .dependsOn(webknossosJni)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .enablePlugins(ProtocPlugin)
  .settings(javah / target := (webknossosJni / nativeCompile / sourceDirectory).value / "include")
  .settings(
    name := "webknossos-datastore",
    commonSettings,
    generateReverseRouter := false,
    BuildInfoSettings.webknossosDatastoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosDatastoreDependencies,
    dependencyOverrides ++= Dependencies.dependencyOverrides,
    protocolBufferSettings,
    Compile / unmanagedJars ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ((subs / "target") ** "*") filter { f =>
        f.name.startsWith("scala-") && f.isDirectory
      }
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    },
    copyMessagesFilesSetting
  )

lazy val webknossosTracingstore = (project in file("webknossos-tracingstore"))
  .dependsOn(webknossosDatastore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings(
    name := "webknossos-tracingstore",
    commonSettings,
    generateReverseRouter := false,
    BuildInfoSettings.webknossosTracingstoreBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosTracingstoreDependencies,
    dependencyOverrides ++= Dependencies.dependencyOverrides,
    copyMessagesFilesSetting
  )

lazy val webknossos = (project in file("."))
  .dependsOn(util, webknossosTracingstore)
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings(
    name := "webknossos",
    commonSettings,
    generateReverseRouter := false,
    AssetCompilation.settings,
    BuildInfoSettings.webknossosBuildInfoSettings,
    libraryDependencies ++= Dependencies.webknossosDependencies,
    dependencyOverrides ++= Dependencies.dependencyOverrides,
    Assets / sourceDirectory := file("none"),
    // The following two assignments avoid that the public assets
    // appear in two output jars. Namely, target/universal/stage/lib/webknossos.webknossos-wk-sans-externalized.jar
    // does not need to contain them. Might be fixed automatically with Play 2.9.4 and 3.0.4
    // See this discussion for context:
    // https://github.com/playframework/playframework/issues/5765#issuecomment-1996991474
    Assets / WebKeys.exportedMappings := Seq(),
    TestAssets / WebKeys.exportedMappings := Seq(),
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
