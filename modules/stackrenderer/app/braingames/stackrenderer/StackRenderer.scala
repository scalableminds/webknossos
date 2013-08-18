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
import scala.sys.process._
import java.io.{File, PrintWriter}
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
import net.liftweb.common._

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
      renderStack(stack) match {
        case Full(_) =>
          sender ! RenderingFinished(stack)
        case f: Failure =>
          sender ! RenderingFailed(stack, f)
        case Empty =>
          sender ! RenderingFailed(stack, Failure("Rendering returned Empty result"))
      }

  }

  def withProcess[A](process: Process)(f: Process => A): A = {
    val r = f(process)
    process.destroy()
    r
  }

  def produceStackFrames(stack: Stack, levelUrl: String, binaryDataUrl: String): Box[Int] = {
    val js = html.stackrenderer.phantom(stack, levelUrl, binaryDataUrl).body

    val jsFile = FileIO.createTempFile(js, ".js")
    val phantomCMD = "phantomjs" :: jsFile.getAbsolutePath :: Nil
    Logger.info(phantomCMD.mkString(" "))
    withProcess(phantomCMD.run(logger, false)) {
      process =>
        Await.result(
          Future {
            val e = process.exitValue()
            Logger.debug("Finished phantomjs. ExitValue: " + e)
            if (e == 0)
              Full(e)
            else
              Failure(s"Phantom execution failed with code $e")
          }.recover {
            case e =>
              Failure("Phantom execution threw: " + e)
          }, phantomTimeout)
    }
  }

  def renderStack(stack: Stack): Box[Boolean] = {
    for {
      _ <- produceStackFrames(stack, useLevelUrl.format(stack.level.id, stack.mission.id), binaryDataUrl)
      stackImages <- createStackImages(stack)
      result <- tarStack(stack, (stack.metaFile :: stack.xmlAtlas :: stackImages))
    } yield {
      result
    }
  }

  def createStackImages(stack: Stack): Box[List[File]] = {
    val images = stack.frames.map(ImageIO.read)
    val params = ImageCreatorParameters(
      bytesPerElement = 1,
      slideWidth = stack.level.width,
      slideHeight = stack.level.height,
      imagesPerRow = maxSpriteSheetWidth / stack.level.width,
      imagesPerColumn = maxSpriteSheetHeight / stack.level.height)

    Box(ImageCreator.createSpriteSheet(images, params, ImageCreator.defaultTargetType)).flatMap {
      combinedImage =>
        val files = combinedImage.pages.map {
          p =>
            new PNGWriter().writeToFile(p.image, new File(stack.path + "/" + p.pageInfo.name))
        }
        XmlAtlas.writeToFile(combinedImage, stack.xmlAtlas)
        completeMetaFileInformation(stack, combinedImage.pages).map(_ =>
          files
        )
    }
  }

  def tarStack(stack: Stack, files: List[File]) = {
    def createTarName(file: File) = s"${stack.mission.id}/${file.getName}"
    try {
      val output = new FileOutputStream(stack.tarFile)
      val inputs = files.map(f => f -> createTarName(f))

      TarIO.tar(inputs, output)
      Logger.debug("Finished taring")
      Full(true)
    } catch {
      case e: Exception =>
        Logger.error(s"failed to create tar for stack: $stack")
        Logger.error(s"$e")
        Failure("Failed to tar stack: " + e)
    }
  }

  def completeMetaFileInformation(stack: Stack, pages: List[CombinedPage]): Box[File] = {
    val additionalInformation = Json.obj(
      "levelName" -> stack.level.levelId.name,
      "levelVersion" -> stack.level.levelId.version,
      "levelId" -> stack.level.id,
      "stackId" -> stack.mission.id,
      "missionId" -> stack.mission.missionId,
      "sprites" -> pages.map {
        p =>
          Json.obj(
            "name" -> p.pageInfo.name,
            "start" -> p.pageInfo.start,
            "count" -> p.pageInfo.number)
      })
    appendToMetaFile(additionalInformation, stack.metaFile)
  }

  def appendToMetaFile(json: JsObject, metaFile: File): Box[File] = {
    if (metaFile.exists) {
      val metaJson = JsonHelper.JsonFromFile(metaFile).as[JsObject]
      printToFile(metaFile)(_.println((metaJson ++ json).toString))
    } else {
      Failure("Couldn't find meta file after phantom generation")
    }
  }

  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit): Box[File] = {
    val p = new java.io.PrintWriter(f)
    try {
      op(p)
      Full(f)
    } catch {
      case e: Exception =>
        Failure("PrintToFile failed: " + e.toString)
    } finally {
      p.close()
    }
  }
}
