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


case class CreateLevels(level: Level, mission: List[Mission])

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
  def stackPath(level: Level, mission: Mission) = "public/levelStacks/%s/%d".format(level.name, mission.start.startId)
  val logger = new ExecLogger
  
  def receive = {
    case CreateLevels(level, missions) =>
     sender ! createLevels(level, missions)
  }
  
  def createTempFile(data: String) = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + ".js")
    val out = new PrintWriter( temp )
    try{ out.print( data ) }
    finally{ out.close }
    temp
  }
  
  def createLevels(level: Level, missions: List[Mission]) = {
    for{mission <- missions}{
      val levelUrl = "http://%s:%d".format(server, port) + 
        controllers.levelcreator.routes.LevelCreator.use(level.id, mission.start.startId)
  
      val js = html.levelcreator.phantom(
          level, 
          stackPath(level, mission) + "/stackImage%i.png", 
          stackPath(level, mission) + "/meta.json", 
          levelUrl,
          mission.start.startId).body
      val file = createTempFile(js)
      println("phantomjs " + file.getAbsolutePath())
      ("phantomjs %s".format(file.getAbsolutePath)) !! logger
      println("Finished phantomjs.")     
      zipFiles(level, mission)
    }
    level.addRenderedMissions(missions.map(_.start.startId))
    Messages("level.stack.created")
  }
  
  def zipFiles(level: Level, mission: Mission) = {
    val stackDir = new File(stackPath(level, mission))
    if (stackDir.exists()){
      val zipFile = stackPath(level, mission) + "/%s_%s_stack.zip".format(level.name, mission.start.startId)
      val pngFilter = new FileExtensionFilter(".png")
      val cmd = "zip %s %s".format(zipFile, stackDir.listFiles(pngFilter).mkString(" ") )
      cmd !! logger
      println("Finished zipping")
    }
    else
      println("error: stackDir %s was not created during stack Creation".format(stackPath(level,mission)))
  }
}
