import sbt._

name := "webknossos"

version := scala.io.Source.fromFile("version").mkString.trim

scalaVersion := "2.11.7"


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

lazy val buildInfoSettings = Seq(
  buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion,
    "commitHash" -> new java.lang.Object() {
      override def toString(): String = {
        try {
          val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git rev-parse HEAD").getInputStream())
          (new java.io.BufferedReader(extracted)).readLine()
        } catch {
          case t: Throwable => "get git hash failed"
        }
      }
    }.toString(),
    "commitDate" -> new java.lang.Object() {
      override def toString(): String = {
        try {
          val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git log -1 --format=%cd ").getInputStream())
          (new java.io.BufferedReader(extracted)).readLine()

        } catch {
          case t: Throwable => "get git date failed"
        }
      }
    }.toString()
  ),
  buildInfoPackage := "webknossos",
  buildInfoOptions := Seq(BuildInfoOption.ToJson)
)

lazy val webknossos = (project in file("."))
  .enablePlugins(play.sbt.PlayScala)
  .enablePlugins(BuildInfoPlugin)
  .settings((webknossosSettings ++ AssetCompilation.settings ++ buildInfoSettings):_*)
