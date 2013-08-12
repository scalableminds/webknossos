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
import braingames.util.TarIO
import braingames.util.FileIO
import braingames.image._
import javax.imageio.ImageIO
import scala.concurrent.Await
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

case class RenderStack(stack: Stack)

case class ExecLogger(var messages: List[String] = Nil,
                      var error: List[String] = Nil)
    extends ProcessLogger {
  def out(s: => String) {
    messages ::= s
    Logger.trace(s)
  }

  def err(s: => String) {
    error ::= s
    Logger.error(s)
  }

  def buffer[T](f: => T): T = f
}

class StackRenderer(useLevelUrl: String, binaryDataUrl: String) extends Actor {

  val logger = new ExecLogger

  val conf = Play.current.configuration

  val imagesPerRow = conf.getInt("stackrenderer.imagesPerRow") getOrElse 10
  val phantomTimeout = (conf.getInt("stackrenderer.phantom.timeout") getOrElse 30) minutes

  def receive = {
    case RenderStack(stack) =>
      if (renderStack(stack))
        sender ! FinishedStack(stack)
      else
        sender ! FailedStack(stack)

  }

  def produceStackFrames(stack: Stack, levelUrl: String, binaryDataUrl: String) = {
    val js = html.stackrenderer.phantom(
      stack,
      levelUrl,
      binaryDataUrl).body

    val jsFile = FileIO.createTempFile(js, ".js")
    Logger.info("phantomjs " + jsFile.getAbsolutePath())
    val process = ("phantomjs" :: jsFile.getAbsolutePath :: Nil).run(logger, false)
    val exitValue = Await.result(
      Future {
        process.exitValue()
      }.recover {
        case e =>
          Logger.warn("Phantom execution threw: " + e)
          -1
      }, phantomTimeout)
    process.destroy()
    Logger.debug("Finished phantomjs. ExitValue: " + exitValue)
    exitValue == 0
  }

  def renderStack(stack: Stack): Boolean = {
    val success = produceStackFrames(stack, useLevelUrl.format(stack.level.id, stack.mission.id), binaryDataUrl)

    if (stack.isProduced && success) {
      createStackImage(stack)
      tarStack(stack)
      true
    } else {
      Logger.error(s"stack $stack was not properly produced")
      false
    }
  }

  def createStackImage(stack: Stack) {
    val images = stack.frames.map(ImageIO.read)
    val params = ImageCreatorParameters(
      bytesPerElement = 1,
      slideWidth = stack.level.width,
      slideHeight = stack.level.height,
      imagesPerRow = imagesPerRow)
    ImageCreator.createSpriteSheet(images, params, ImageCreator.defaultTargetType).map { combinedImage =>
      new PNGWriter().writeToFile(combinedImage.image, stack.image)
      XmlAtlas.writeToFile(combinedImage.info, stack.image.getName, stack.xmlAtlas)
    }

  }

  def tarStack(stack: Stack) {
    def createTarName(file: File) = s"${stack.mission.id}/${file.getName}"
    (Try {
      val output =
        new FileOutputStream(stack.tarFile)
      val inputs =
        (stack.metaFile :: stack.image :: stack.xmlAtlas :: Nil).map { f =>
          f -> createTarName(f)
        }
      TarIO.tar(inputs, output)
    }) match {
      case Success(_) =>
        Logger.debug("Finished taring")
      case Failure(exception) =>
        Logger.error(s"failed to create tar for stack: $stack")
        Logger.error(s"$exception")
        None
    }
  }
}
