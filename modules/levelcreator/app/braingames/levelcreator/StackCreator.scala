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
import models.knowledge._
import scala.sys.process._
import play.api.i18n.Messages
import java.io.{ File, PrintWriter, FilenameFilter }
import scala.util.{ Try, Success, Failure }
import braingames.util.FileExtensionFilter
import braingames.util.ZipIO
import java.io.{FileOutputStream, FileInputStream}

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

class StackCreator extends Actor {
  val server = "localhost"
  val port = Option(System.getProperty("http.port")).map(Integer.parseInt(_)).getOrElse(9000)
  val logger = new ExecLogger

  def receive = {
    case CreateStack(level, mission) =>
      context.parent ! FinishedStack(level, mission, createStack(level, mission))
  }

  def createTempFile(data: String) = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + ".js")
    val out = new PrintWriter(temp)
    try { out.print(data) }
    finally { out.close }
    temp
  }

  def produceStack(stack: Stack, levelUrl: String) = {
    val js = html.levelcreator.phantom(
      stack,
      levelUrl).body

    val jsFile = createTempFile(js)
    Logger.info("phantomjs " + jsFile.getAbsolutePath())
    ("phantomjs" :: jsFile.getAbsolutePath :: Nil) !! logger
    Logger.info("Finished phantomjs.")
  }

  def createStack(level: Level, mission: Mission): Option[Stack] = {
    (Try {
      val stack = Stack(level, mission)
      produceStack(stack, "http://%s:%d".format(server, port) +
        controllers.levelcreator.routes.LevelCreator.use(level.id, mission.id))

      if (stack.isProduced) {
        zipStack(stack)
        stack
      } else
        throw new Exception(s"stack $stack was not properly produced")
    }) match {
      case Success(stack) => Some(stack)
      case Failure(exception) =>
        Logger.error(s"$exception")
        None
    }
  }

  def zipStack(stack: Stack) {   
    def createZipName(file: File) = s"${stack.mission.id}/${file.getName}"
    (Try {
    val output = new FileOutputStream(stack.zipFile)
    val inputs = stack.images.map(new FileInputStream(_))
    val namesInZip = stack.images.map(createZipName(_))
    ZipIO.zip(inputs.zip(namesInZip),output)
    }) match {
      case Success(_) => Logger.info("Finished zipping")
      case Failure(exception) =>
        Logger.error(s"failed zipping stack: $stack")
        Logger.error(s"$exception")
        None
    }    
  }
}
