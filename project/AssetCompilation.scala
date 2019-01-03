import java.nio.file.{Files, StandardCopyOption}
import java.util.function.Consumer

import sbt.Keys._
import sbt._
import sys.process.Process

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

object AssetCompilation {
  object SettingsKeys {
    val npmPath = SettingKey[String]("npm-path", "where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.Keys._

  def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, params: List[String], base: File) = {
    if (isWindowsSystem)
      Process("cmd" :: "/c" :: app :: params, base)
    else
      Process(app :: params, base)
  }

  private def killProcess(pid: String) = {
    if (isWindowsSystem)
      Process("kill" :: "-f" :: pid :: Nil).run()
    else
      Process("kill" :: pid :: Nil).run()
  }

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = Def task {
    try {
      val exitValue = startProcess(
        npmPath.value,
        List("install", "--frozen-lockfile"),
        baseDirectory.value
      ) ! streams.value.log
      if (exitValue != 0)
        throw new Error(s"Running npm failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        streams.value.log.error(
          "Npm couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage
        )
    }

    Seq()
  }

  private def copyRecursively(from: File, to: File): Unit = {
    def toConsumer[A](function: A => Any): Consumer[A] = new Consumer[A]() {
      override def accept(arg: A): Unit = function.apply(arg)
    }

    Files
      .walk(from.toPath)
      .forEach(toConsumer(cpSrc => {
        val cpDest = to.toPath.resolve(from.toPath.relativize(cpSrc))
        Files.copy(cpSrc, cpDest)
      }))
  }

  private def deleteRecursively(file: File): Unit = {
    if (file.isDirectory)
      file.listFiles.foreach(deleteRecursively)
    if (!file.delete && file.exists)
      throw new Exception(s"Unable to delete ${file.getAbsolutePath}")
  }

  private def assetsGenerationTask: Def.Initialize[Task[Unit]] =
    Def task {
      // copy tools/postgres
      try {
        val destination = target.value / "universal" / "stage" / "tools" / "postgres"
        destination.mkdirs
        (baseDirectory.value / "tools" / "postgres")
          .listFiles()
          .foreach(
            file =>
              Files.copy(
                file.toPath,
                (destination / file.name).toPath,
                StandardCopyOption.REPLACE_EXISTING
            )
          )
      } catch {
        case e: Exception =>
          streams.value.log
            .error("Could not copy SQL schema to stage dir: " + e.getMessage)
      }

      // copy node_modules for diff_schema.js
      {
        val nodeModules =
          Seq("commander", "randomstring", "glob", "rimraf", "replace-in-file")
        val nodeSrc = baseDirectory.value / "node_modules"
        val nodeDest = target.value / "universal" / "stage" / "node_modules"
        val tmpPath = baseDirectory.value / "tmp"
        val streamsValue = streams.value.log

        tmpPath.mkdirs
        startProcess(npmPath.value, List("init", "-y"), tmpPath) ! streamsValue
        nodeModules.foreach(nodeModule => {
          startProcess(npmPath.value, List("add", (nodeSrc / nodeModule).getAbsolutePath), tmpPath) ! streamsValue
        })
        deleteRecursively(nodeDest)
        copyRecursively(tmpPath / "node_modules", nodeDest)
        deleteRecursively(tmpPath)
      }

    } dependsOn npmInstall

  private def slickClassesFromDBSchemaTask: Def.Initialize[Task[Seq[File]]] =
    Def task {
      val streamsValue = streams.value
      val baseDirectoryValue = baseDirectory.value
      val dependencyClasspathValue = (dependencyClasspath in Compile).value
      val runnerValue = (runner in Compile).value
      val sourceManagedValue = sourceManaged.value

      val schemaPath = baseDirectoryValue / "tools" / "postgres" / "schema.sql"
      val slickTablesOutPath = sourceManagedValue / "schema" / "com" / "scalableminds" / "webknossos" / "schema" / "Tables.scala"

      val shouldUpdate = !slickTablesOutPath.exists || slickTablesOutPath.lastModified < schemaPath.lastModified

      if (shouldUpdate) {
        streamsValue.log.info(
          "Ensuring Postgres DB is running for Slick code generation..."
        )
        startProcess(
          (baseDirectoryValue / "tools" / "postgres" / "ensure_db.sh").toString,
          List(),
          baseDirectoryValue
        ) ! streamsValue.log

        streamsValue.log.info(
          "Updating Slick SQL schema from local database..."
        )

        runnerValue.run(
          "slick.codegen.SourceCodeGenerator",
          dependencyClasspathValue.files,
          Array(
            "file://" + (baseDirectoryValue / "conf" / "application.conf").toString + "#slick",
            (sourceManagedValue / "schema").toString
          ),
          streamsValue.log
        )

      } else {
        streamsValue.log.info("Slick SQL schema already up to date.")
      }

      Seq((slickTablesOutPath))
    }

  val settings = Seq(
    AssetCompilation.SettingsKeys.npmPath := "yarn",
    stage := (stage dependsOn assetsGenerationTask).value,
    dist := (dist dependsOn assetsGenerationTask).value,
    sourceGenerators in Compile += slickClassesFromDBSchemaTask,
    managedSourceDirectories in Compile += sourceManaged.value
  )
}
