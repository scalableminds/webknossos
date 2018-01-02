import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

import com.typesafe.sbt.web.Import._
import play.sbt.Play.autoImport._
import play.sbt.routes.RoutesKeys._
import play.twirl.sbt.Import._
import sbt.Keys._
import sbt.{Task, _}
import sbt._

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
    try{
      val exitValue = startProcess(webpack, List("--env.production"), base) ! s.log
      if(exitValue != 0)
        throw new Error(s"Running webpack failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        s.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  val settings = Seq(
    AssetCompilation.SettingsKeys.webpackPath := (Path("node_modules") / ".bin" / "webpack").getPath,
    AssetCompilation.SettingsKeys.npmPath := "yarn",
    run in Compile <<= (run in Compile) map(killWebpack) dependsOn webpackGenerateTask,
    stage <<= stage dependsOn assetsGenerationTask,
    dist <<= dist dependsOn assetsGenerationTask
  )
}
