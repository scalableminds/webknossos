package braingames.levelcreator

import akka.actor._
import scala.concurrent.duration._
import play.api.libs.json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import akka.util.Timeout
import akka.pattern.ask
import play.api.Play.current
import org.apache.commons.mail._
import java.util.concurrent.Future
import java.lang.reflect._
import javax.mail.internet.InternetAddress
import scala.collection.JavaConversions._
import play.api._
import play.api.Configuration._
import views._
import models.knowledge.{Level, Mission}
import scala.sys.process._
import play.api.i18n.Messages
import java.io.{File, PrintWriter, FilenameFilter}
import scala.util.{Try, Success, Failure}
import braingames.util.FileExtensionFilter


case class CreateStack(level: Level, mission: Mission)

case class ExecLogger(var messages: List[String] = Nil,
  var error: List[String] = Nil)
  extends ProcessLogger {
  def out(s: => String) {
    messages ::= s
    Logger.info(s)
  }

  def err(s: => String) {
    error ::= s
    Logger.error(s)
  }

  def buffer[T](f: => T): T = f
}

class StackCreator extends Actor{
  val server = "localhost"
  val port = Option(System.getProperty("http.port")).map(Integer.parseInt(_)).getOrElse(9000)
  def stackPath(level: Level, mission: Mission) = level.stackFolder+"/%s".format(mission.id)
  val logger = new ExecLogger
  val pngFilter = new FileExtensionFilter(".png")
  
  def receive = {
    case CreateStack(level, mission) =>
     sender ! createStack(level, mission)
  }
  
  def createTempFile(data: String) = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + ".js")
    val out = new PrintWriter( temp )
    try{ out.print( data ) }
    finally{ out.close }
    temp
  }

  def createStack(level: Level, mission: Mission) = {
    (Try {
      val levelUrl = "http://%s:%d".format(server, port) + 
        controllers.levelcreator.routes.LevelCreator.use(level.id, mission.id)
  
      val js = html.levelcreator.phantom(
            level, 
            stackPath(level, mission) + "/stackImage%i.png", 
            stackPath(level, mission) + "/meta.json", 
            levelUrl,
            mission.id).body
          
      val file = createTempFile(js)
      Logger.info("phantomjs " + file.getAbsolutePath())
      ("phantomjs %s".format(file.getAbsolutePath)) !! logger
      Logger.info("Finished phantomjs.")     
      zipFiles(level, mission)
      mission
    }) match {
      case Success(m) => Some(m)
      case Failure(exception) => 
        Logger.error(s"failed creating stack for level:${level.id} mission:${mission.id}")
        Logger.error(s"$exception")
        None
    }
  }
  
  def zipFiles(level: Level, mission: Mission) = {
    val stackDir = new File(stackPath(level, mission))
    if (stackDir.exists()){
      val zipFile= stackPath(level, mission) + "/%s_%s_stack.zip".format(level.name, mission.id)
      val stackImages = stackDir.listFiles(pngFilter).toList.map(_.toString)
      ("zip" :: zipFile :: stackImages ) !! logger
      Logger.info("Finished zipping")
    }
    else
     Logger.error("stackDir %s was not created during stack Creation".format(stackPath(level,mission)))
  }
}
