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

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = Def task {
    try{
      val exitValue = startProcess(npmPath.value, List("install"), baseDirectory.value) ! streams.value.log
      if(exitValue != 0)
        throw new Error(s"Running npm failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        streams.value.log.error("Npm couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage)
    }

    Seq()
  }

  private def webpackGenerateTask: Def.Initialize[Task[Any]] = Def task {
    try{
      Future{
        startProcess(webpackPath.value, List("-w"), baseDirectory.value) ! streams.value.log
      }
    } catch {
      case e: java.io.IOException =>
        streams.value.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
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

  private def assetsGenerationTask: Def.Initialize[Task[Unit]] = Def task {
    try {
      val destination = target.value  / "universal" / "stage" / "tools" / "postgres"
      destination.mkdirs
      (baseDirectory.value / "tools" / "postgres").listFiles().foreach(
        file => Files.copy(file.toPath, (destination / file.name).toPath, StandardCopyOption.REPLACE_EXISTING)
      )
    } catch {
      case e: Exception => streams.value.log.error("Could not copy SQL schema to stage dir: " + e.getMessage)
    }
    try{
      val exitValue = startProcess(webpackPath.value, List("--env.production"), baseDirectory.value) ! streams.value.log
      if(exitValue != 0)
        throw new Error(s"Running webpack failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        streams.value.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  private def slickClassesFromDBSchemaTask: Def.Initialize[Task[Seq[File]]] = Def task{
      val streamsVal = streams.value
      val runnerVal = (runner in Compile).value
      val dependencyClasspathVal = (dependencyClasspath in Compile).value

      val schemaPath = baseDirectory.value / "tools" / "postgres" / "schema.sql"
      val slickTablesOutPath = sourceManaged.value / "schema" / "com" / "scalableminds" / "webknossos" / "schema" / "Tables.scala"

      val shouldUpdate = !slickTablesOutPath.exists || slickTablesOutPath.lastModified < schemaPath.lastModified

      if (shouldUpdate) {
        streamsVal.log.info("Ensuring Postgres DB is running for Slick code generation...")
        startProcess((baseDirectory.value / "tools" / "postgres" / "ensure_db.sh").toString, List(), baseDirectory.value)  ! streamsVal.log

        streamsVal.log.info("Updating Slick SQL schema from local database...")

        runnerVal.run("slick.codegen.SourceCodeGenerator", dependencyClasspathVal.files,
          Array("file://" + (baseDirectory.value / "conf" / "application.conf").toString + "#slick", (sourceManaged.value / "schema").toString),
          streamsVal.log
        )

      } else {
        streamsVal.log.info("Slick SQL schema already up to date.")
      }

      Seq((slickTablesOutPath))
    }

  val settings = Seq(
    AssetCompilation.SettingsKeys.webpackPath := (Path("node_modules") / ".bin" / "webpack").getPath,
    AssetCompilation.SettingsKeys.npmPath := "yarn",
    run in Compile := {(run in Compile) map(killWebpack) dependsOn webpackGenerateTask},
    sourceGenerators in Compile += Def.task[Seq[File]] {slickClassesFromDBSchemaTask.value},
    managedSourceDirectories in Compile += sourceManaged.value,
    stage := (stage dependsOn assetsGenerationTask).value,
    dist := (dist dependsOn assetsGenerationTask).value
  )
}
