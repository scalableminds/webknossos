import java.nio.file.{Files, StandardCopyOption}

import sbt.Keys._
import sbt._
import sys.process.Process

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

object AssetCompilation {
  object SettingsKeys {
    val webpackPath = SettingKey[String]("webpack-path", "where webpack is installed")
    val npmPath = SettingKey[String]("npm-path", "where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.Keys._

  def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, params: List[String], base: File) = {
    if(isWindowsSystem)
      Process( "cmd" :: "/c" :: app :: params, base )
    else
      Process( app :: params, base )
  }

  private def killProcess(pid: String) = {
    if(isWindowsSystem)
      Process("kill" :: "-f" :: pid :: Nil).run()
    else
      Process("kill" :: pid :: Nil).run()
  }

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = Def.task {
    val npm = npmPath.value
    val base = baseDirectory.value
    val s = streams.value
    try{
      val exitValue = startProcess(npm, List("install"), base) ! s.log
      if(exitValue != 0)
        throw new Error(s"Running npm failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        s.log.error("Npm couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage)
    }
    Seq()
  }

  private def webpackGenerateTask: Def.Initialize[Task[Any]] = Def.task {
    val webpack = webpackPath.value
    val base = baseDirectory.value
    val s = streams.value
    val t = target.value
    try{
      Future{
        startProcess(webpack, List("-w"), base) ! s.log
      }
    } catch {
      case e: java.io.IOException =>
        s.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  private def killWebpack(x: Unit) = {
    val pidFile = Path("target") / "webpack.pid"
    if(pidFile.exists){
      val pid = scala.io.Source.fromFile(pidFile).mkString.trim
      killProcess(pid)
      pidFile.delete()
      println("Pow, Pow. Blood is everywhere, webpack is gone!")
    }
  }

  private def assetsGenerationTask: Def.Initialize[Task[Unit]] = Def.task {
    val webpack = webpackPath.value
    val base = baseDirectory.value
    val s = streams.value
    val t = target.value
    try {
      val destination = t  / "universal" / "stage" / "tools" / "postgres"
      destination.mkdirs
      (base / "tools" / "postgres").listFiles().foreach(
        file => Files.copy(file.toPath, (destination / file.name).toPath, StandardCopyOption.REPLACE_EXISTING)
      )
    } catch {
      case e: Exception => s.log.error("Could not copy SQL schema to stage dir: " + e.getMessage)
    }
    try{
      val exitValue = startProcess(webpack, List("--env.production"), base) ! s.log
      if(exitValue != 0)
        throw new Error(s"Running webpack failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        s.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  private def slickClassesFromDBSchemaTask: Def.Initialize[Task[Seq[File]]] = Def.task {
    val runnerVal = (runner in Compile).value
    val dc = (dependencyClasspath in Compile).value
    val sourceManagedVal = (sourceManaged in Compile).value
    val base = baseDirectory.value
    val s = streams.value
    val t = target.value

    val schemaPath = base / "tools" / "postgres" / "schema.sql"
    val slickTablesOutPath = sourceManagedVal / "schema" / "com" / "scalableminds" / "webknossos" / "schema" / "Tables.scala"

    val shouldUpdate = !slickTablesOutPath.exists || slickTablesOutPath.lastModified < schemaPath.lastModified

    if (shouldUpdate) {
      s.log.info("Ensuring Postgres DB is running for Slick code generation...")
      startProcess((base / "tools" / "postgres" / "ensure_db.sh").toString, List(), base)  ! s.log

      s.log.info("Updating Slick SQL schema from local database...")

      runnerVal.run("slick.codegen.SourceCodeGenerator", dc.files,
        Array("file://" + (base / "conf" / "application.conf").toString + "#slick", (sourceManagedVal / "schema").toString),
        s.log
      )

    } else {
      s.log.info("Slick SQL schema already up to date.")
    }

    Seq((slickTablesOutPath))
  }

  val settings = Seq(
    AssetCompilation.SettingsKeys.webpackPath := (Path("node_modules") / ".bin" / "webpack").getPath,
    AssetCompilation.SettingsKeys.npmPath := "yarn",
    run in Compile := {(run in Compile) map(killWebpack) dependsOn webpackGenerateTask},
    sourceGenerators in Compile += slickClassesFromDBSchemaTask,
    managedSourceDirectories in Compile += sourceManaged.value,
    stage := (stage dependsOn assetsGenerationTask).value,
    dist := (dist dependsOn assetsGenerationTask).value
  )
}
