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
import braingames.util.JsonHelper
import java.awt.image.BufferedImage

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

  val phantomTimeout = (conf.getInt("stackrenderer.phantom.timeout") getOrElse 30) minutes

  val maxSpriteSheetHeight = 2048
  val maxSpriteSheetWidth = 2048

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

      val stackImages = createStackImages(stack) getOrElse Nil
      tarStack(stack, (stack.metaFile :: stack.xmlAtlas :: stackImages))
      true
    } else {
      Logger.error(s"stack $stack was not properly produced")
      false
    }
  }

  def createStackImages(stack: Stack): Option[List[File]] = {
    val images = stack.frames.map(ImageIO.read)
    val params = ImageCreatorParameters(
      slideWidth = stack.level.width,
      slideHeight = stack.level.height,
      imagesPerRow = maxSpriteSheetWidth / stack.level.width,
      imagesPerColumn = maxSpriteSheetHeight / stack.level.height)
    //create single image
    // TODO: needs to be removed in the future
    val stackImage = ImageCreator.createBigImages(
      images,
      params.copy(imagesPerColumn = 1000000)).map { combinedImage =>
        combinedImage.pages.map { p =>
          new PNGWriter().writeToFile(p.image, new File(stack.path + "/stack.png"))
        }
      } getOrElse Nil

    ImageCreator.createBigImages(images, params).map { combinedImage =>
      val files = combinedImage.pages.map { p =>
        new PNGWriter().writeToFile(p.image, new File(stack.path + "/" + p.pageInfo.name))
      }
      writeMetaFile(stack, combinedImage.pages)
      XmlAtlas.writeToFile(combinedImage, stack.xmlAtlas)
      files
    }.map(_ ::: stackImage)

  }

  def tarStack(stack: Stack, files: List[File]) {
    def createTarName(file: File) = s"${stack.mission.id}/${file.getName}"
    (Try {
      val output =
        new FileOutputStream(stack.tarFile)
      val inputs = files.map { f =>
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

  def writeMetaFile(stack: Stack, pages: List[CombinedPage]) = {
    val json = Json.obj(
      "levelName" -> stack.level.levelId.name,
      "levelVersion" -> stack.level.levelId.version,
      "levelId" -> stack.level.id,
      "stackId" -> stack.mission.id,
      "sprites" -> pages.map { p =>
        Json.obj(
          "name" -> p.pageInfo.name,
          "start" -> p.pageInfo.start,
          "count" -> p.pageInfo.number)
      })
    val originalJson =
      if (stack.metaFile.exists)
        JsonHelper.JsonFromFile(stack.metaFile).as[JsObject]
      else
        Json.obj()
    printToFile(stack.metaFile)(_.println((originalJson ++ json).toString))
  }

  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit): File = {
    val p = new java.io.PrintWriter(f)
    try { op(p) } finally { p.close() }
    f
  }
}
