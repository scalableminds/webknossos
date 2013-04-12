package braingames.stackrenderer

import akka.actor._
import scala.concurrent.duration._
import play.api.libs.json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import org.apache.commons.mail._
import java.lang.reflect._
import scala.collection.JavaConversions._
import play.api._
import play.api.Configuration._
import views._
import models.knowledge._
import scala.sys.process._
import java.io.{ File, PrintWriter }
import scala.util.{ Try, Success, Failure }
import braingames.levelcreator.CreateStack
import models.knowledge.Stack
import java.io.FileOutputStream
import java.io.FileInputStream
import braingames.util.ZipIO

case class RenderStack(id: String, stack: Stack)

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

class StackRenderer extends Actor {
  
  val conf = Play.current.configuration
  
  val levelcreatorBaseUrl = 
    conf.getString("levelcreator.baseUrl") getOrElse ("http://localhost:9000")
    
  val logger = new ExecLogger

  def receive = {
    case RenderStack(id, stack) =>
      if (renderStack(stack))
        sender ! FinishedStack(id, stack)
      else
        sender ! FailedStack(id, stack)

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
    Logger.debug("Finished phantomjs.")
  }

  def renderStack(stack: Stack): Boolean = {
    produceStack(stack, levelcreatorBaseUrl +
      controllers.levelcreator.routes.LevelCreator.use(stack.level.id, stack.mission.id))

    if (stack.isProduced) {
      zipStack(stack)
      true
    } else {
      Logger.error(s"stack $stack was not properly produced")
      false
    }
  }

  def zipStack(stack: Stack) {
    def createZipName(file: File) = s"${stack.mission.id}/${file.getName}"
    (Try {
      val output = new FileOutputStream(stack.zipFile)
      val inputs = stack.images.map(new FileInputStream(_))
      val namesInZip = stack.images.map(createZipName(_))
      ZipIO.zip(inputs.zip(namesInZip), output)
    }) match {
      case Success(_) => Logger.debug("Finished zipping")
      case Failure(exception) =>
        Logger.error(s"failed zipping stack: $stack")
        Logger.error(s"$exception")
        None
    }
  }
}
