import java.nio.file.{Files, StandardCopyOption}

import sbt.Keys._
import sbt.{Task, _}

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

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = (npmPath, baseDirectory, streams) map { (npm, base, s) =>
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

  private def webpackGenerateTask: Def.Initialize[Task[Any]] = (webpackPath, baseDirectory, streams, target) map { (webpack, base, s, t) =>
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

  private def assetsGenerationTask: Def.Initialize[Task[Unit]] = (webpackPath, baseDirectory, streams, target) map { (webpack, base, s, t) =>
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

  private def slickClassesFromDBSchemaTask: Def.Initialize[Task[Seq[File]]] =
    (runner in Compile, dependencyClasspath in Compile, sourceManaged, baseDirectory, streams, target) map { (runner, dc, sourceManaged, base, s, t) =>

      val schemaPath = base / "tools" / "postgres" / "schema.sql"
      val slickTablesOutPath = sourceManaged / "schema" / "com" / "scalableminds" / "webknossos" / "schema" / "Tables.scala"

      val shouldUpdate = !slickTablesOutPath.exists || slickTablesOutPath.lastModified < schemaPath.lastModified

      if (shouldUpdate) {
        s.log.info("Ensuring Postgres DB is running for Slick code generation...")
        startProcess((base / "tools" / "postgres" / "ensure_db.sh").toString, List(), base)  ! s.log

        s.log.info("Updating Slick SQL schema from local database...")

        //cannot use play config because this happens before play lifecycle. Thus, parsing the config file directly
        val conf = com.typesafe.config.ConfigFactory.parseFile(new File("conf/application.conf")).resolve()

        val pgUrl = sys.env.get("POSTGRES_URL").getOrElse(conf.getString("postgres.url"))
        val pgUser = conf.getString("postgres.user")
        val pgPass = conf.getString("postgres.password")
        val pgDriver = conf.getString("postgres.driver")

        runner.run("slick.codegen.SourceCodeGenerator", dc.files,
          Array("slick.jdbc.PostgresProfile", pgDriver, pgUrl, (sourceManaged / "schema").toString, "com.scalableminds.webknossos.schema", pgUser, pgPass),
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
    run in Compile <<= (run in Compile) map(killWebpack) dependsOn webpackGenerateTask,
    sourceGenerators in Compile <+= slickClassesFromDBSchemaTask,
    managedSourceDirectories in Compile += sourceManaged.value,
    stage <<= stage dependsOn assetsGenerationTask,
    dist <<= dist dependsOn assetsGenerationTask
  )
}
