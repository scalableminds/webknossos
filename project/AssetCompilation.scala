import java.nio.file.{Files, StandardCopyOption}
import java.util.function.Consumer

import sbt.Keys._
import sbt._
import sys.process.Process

object AssetCompilation {
  object SettingsKeys {
    val yarnPath = SettingKey[String]("npm-path", "where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.Keys._

  private def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, params: List[String], base: File) =
    if (isWindowsSystem)
      Process("cmd" :: "/c" :: app :: params, base)
    else
      Process(app :: params, base)

  private def yarnInstall: Def.Initialize[Task[Seq[File]]] = Def task {
    try {
      val exitValue = startProcess(
        yarnPath.value,
        List("install", "--immutable"),
        baseDirectory.value
      ) ! streams.value.log
      if (exitValue != 0)
        throw new Error(s"Running npm failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        streams.value.log.error(
          "Yarn couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage
        )
    }

    Seq.empty
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
      // copy schema
      try {
        val destination = target.value / "universal" / "stage" / "schema"
        destination.mkdirs
        deleteRecursively(destination)
        copyRecursively(baseDirectory.value / "schema", destination)
      } catch {
        case e: Exception =>
          streams.value.log.error("Could not copy SQL schema to stage dir: " + e.getMessage)
      }

      // copy tools/postgres
      try {
        val destination = target.value / "universal" / "stage" / "tools" / "postgres"
        destination.mkdirs
        deleteRecursively(destination)
        copyRecursively(baseDirectory.value / "tools" / "postgres", destination)
      } catch {
        case e: Exception =>
          streams.value.log.error("Could not copy dbtool to stage dir: " + e.getMessage)
      }

      // copy test/db
      try {
        val destination = target.value / "universal" / "stage" / "test" / "db"
        destination.mkdirs
        deleteRecursively(destination)
        copyRecursively(baseDirectory.value / "test" / "db", destination)
      } catch {
        case e: Exception =>
          streams.value.log.error("Could not test database entries to stage dir: " + e.getMessage)
      }

    } dependsOn yarnInstall

  private def slickClassesFromDBSchemaTask: Def.Initialize[Task[Seq[File]]] =
    Def task {
      val streamsValue = streams.value
      val baseDirectoryValue = baseDirectory.value
      // Classpath of the standalone slick code generator subproject (see build.sbt). It carries our
      // ContentStableSourceCodeGenerator plus slick-codegen and the postgres driver.
      val codegenClasspathValue = (LocalProject("slickCodegen") / Compile / fullClasspath).value
      val runnerValue = (Compile / runner).value
      val sourceManagedValue = sourceManaged.value

      val schemaPath = baseDirectoryValue / "schema" / "schema.sql"
      val schemaOutDir = sourceManagedValue / "schema"
      val slickTablesOutPath = schemaOutDir / "com" / "scalableminds" / "webknossos" / "schema" / "Tables.scala"
      // Records the last successful generation.
      val stampFile = sourceManagedValue / "slick-schema-codegen.stamp"

      // The generator reads the live DB; schema.sql mtime is our proxy for "schema changed". This only
      // gates whether we connect to the DB at all, the generator itself rewrites only the table files
      // whose content actually changed, so re-running it when nothing changed costs no recompiles.
      val shouldUpdate = !slickTablesOutPath.exists || !stampFile.exists || stampFile.lastModified < schemaPath.lastModified

      if (shouldUpdate) {
        streamsValue.log.info(
          "Ensuring Postgres DB is running for Slick code generation..."
        )
        startProcess(
          (baseDirectoryValue / "tools" / "postgres" / "dbtool.js").toString,
          List("ensure-db"),
          baseDirectoryValue
        ) ! streamsValue.log

        streamsValue.log.info(
          "Updating Slick SQL schema from local database..."
        )

        val runResult = runnerValue.run(
          "com.scalableminds.codegen.SchemaCodeGenerator",
          codegenClasspathValue.files,
          Array(
            "file://" + (baseDirectoryValue / "conf" / "slick.conf").toString + "#slick",
            schemaOutDir.toString
          ),
          streamsValue.log
        )
        runResult.failed.foreach(e => streamsValue.log.error("Slick code generation failed: " + e.getMessage))
        // Mark this schema.sql state as generated so we do not re-run until schema.sql changes again.
        if (runResult.isSuccess) IO.touch(stampFile)

      } else {
        streamsValue.log.info("Slick SQL schema already up to date.")
      }

      // Return every generated source so sbt tracks the full set (one file per table plus the container).
      val schemaPackageDir = schemaOutDir / "com" / "scalableminds" / "webknossos" / "schema"
      Option(schemaPackageDir.listFiles).getOrElse(Array.empty[File]).filter(_.getName.endsWith(".scala")).toSeq
    }

  val settings = Seq(
    AssetCompilation.SettingsKeys.yarnPath := "yarn",
    stage := (stage dependsOn assetsGenerationTask).value,
    dist := (dist dependsOn assetsGenerationTask).value,
    Compile / sourceGenerators += slickClassesFromDBSchemaTask,
    Compile / managedSourceDirectories += sourceManaged.value
  )
}
