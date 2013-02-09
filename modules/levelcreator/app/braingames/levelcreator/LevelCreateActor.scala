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
import java.io.{File, PrintWriter, FilenameFilter}


case class CreateLevel(level: Level, mission: Mission)
case class ZipLevel(level: Level, mission: Mission)

case class ExecLogger(var messages: List[String] = Nil,
  var error: List[String] = Nil)
  extends ProcessLogger {
  def out(s: => String) {
    messages ::= s
  }

  def err(s: => String) {
    error ::= s
  }

  def buffer[T](f: => T): T = f
}

class FileExtensionFilter(fileExtension: String) extends FilenameFilter{
  override def accept(dir: File, name: String) = name.endsWith(fileExtension)
}

class LevelCreateActor extends Actor{
  val server = "localhost"
  val port = Option(System.getProperty("http.port")).map(Integer.parseInt(_)).getOrElse(9000)
  def imagesPath(level: Level, mission: Mission) = "data/levels/%s/%d".format(level.name, mission.start.startId)
  val logger = new ExecLogger
  
  def receive = {
    case CreateLevel(level, mission) =>
     sender ! createLevel(level, mission)
    case ZipLevel(level, mission) => 
      createLevel(level, mission);
      sender ! zippedFiles(level, mission)
  }
  
  def createTempFile(data: String) = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + ".js")
    val out = new PrintWriter( temp )
    try{ out.print( data ) }
    finally{ out.close }
    temp
  }
  
  def createLevel(level: Level, mission: Mission) = {
    val levelUrl = "http://%s:%d".format(server, port) + 
      controllers.levelcreator.routes.LevelCreator.use(level.id, mission.start.startId)

    val js = html.levelcreator.phantom(
        level, 
        imagesPath(level, mission) + "/stackImage%i.png", 
        levelUrl).body
    val file = createTempFile(js)
    println("phantomjs " + file.getAbsolutePath())
    ("phantomjs %s".format(file.getAbsolutePath)) !! logger
    println("Finished phantomjs.")
    level.addRenderedMission(mission.start.startId)
    "finished stack creation"
  }
  
  def zippedFiles(level: Level, mission: Mission) = {
    val zipFile = imagesPath(level, mission) + "/stack.zip"
    val stackDir = new File(imagesPath(level, mission))
    val pngFilter = new FileExtensionFilter(".png")
    val cmd = "zip %s %s".format(zipFile, stackDir.listFiles(pngFilter).mkString(" ") )
    cmd.!
    println("Finished zipping")
    new File(zipFile)
  }
}