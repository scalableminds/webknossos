package brainflight.knowledge

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
import models.knowledge.Level
import scala.sys.process._
import java.io.File
import java.io.PrintWriter

case class CreateLevel(level: Level)

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

class LevelCreateActor extends Actor{
  val server = "localhost"
  val port = Option(System.getProperty("http.port")).map(Integer.parseInt(_)).getOrElse(9000)
  def receive = {
    case CreateLevel(level) =>
      createLevel(level)
  }
  
  def createTempFile(data: String) = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + ".js")
    val out = new PrintWriter( temp )
    try{ out.print( data ) }
    finally{ out.close }
    temp
  }
  
  def createLevel(level: Level) = {
    val logger = new ExecLogger
    val missionId = "1"
    val imagesPath = "data/levels/%s/stack/%s/".format(level.name, missionId)
    val levelUrl = "http://%s:%d".format(server, port) + 
      controllers.admin.routes.LevelCreator.use(level.id, missionId)
      
    val js = html.admin.creator.phantom(
        level, 
        imagesPath + "stackImage%i.png", 
        levelUrl).body
    val file = createTempFile(js)
    println("phantomjs " + file.getAbsolutePath())
    ("phantomjs %s".format(file.getAbsolutePath)) !! logger
    println("Finished phantomjs.")
  }
}