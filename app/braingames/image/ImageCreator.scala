package braingames.image

import java.awt.AWTException
import java.awt.Dimension
import java.awt.Rectangle
import java.awt.Robot
import java.awt.Toolkit
import java.awt.image.BufferedImage
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.File
import java.awt.Color
import akka.pattern.ask
import brainflight.tools.geometry.Point3D
import akka.util.Timeout
import play.api.Play.current
import play.api.Play
import akka.pattern.AskTimeoutException
import play.api.libs.concurrent.Akka
import brainflight.tools.geometry.Vector3D
import play.api.Logger
import scala.concurrent.duration._
import scala.concurrent.Promise

case class ImageCreatorParameters(slideWidth: Int = 128, slideHeight: Int = 128, imagesPerRow: Int = 8)

object ImageCreator {

  val targetType = BufferedImage.TYPE_3BYTE_BGR

  def createImage(data: Array[Byte], params: ImageCreatorParameters): Option[BufferedImage] = {
    val images = calculateImageSlices(data, params)
    createBigImage(images, params)
  }

  def calculateImageSlices(data: Array[Byte], params: ImageCreatorParameters): List[BufferedImage] = {
    val targetType = BufferedImage.TYPE_3BYTE_BGR
    data.sliding(params.slideHeight * params.slideWidth, params.slideHeight * params.slideWidth).toList.flatMap { slice =>
      createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  def createBigImage(bufferedImages: List[BufferedImage], params: ImageCreatorParameters) = {
    if (bufferedImages.isEmpty) {
      Logger.warn("No images supplied")
      None
    } else {
      val width = bufferedImages(0).getWidth()
      val height = bufferedImages(0).getHeight()
      val imageType = bufferedImages(0).getType()
      val depth = math.ceil(bufferedImages.size.toFloat / params.imagesPerRow).toInt

      val finalImage = new BufferedImage(width * params.imagesPerRow, height * depth, imageType)

      bufferedImages.zipWithIndex.foreach {
        case (image, idx) =>
          assert(image.getWidth() == width, "Wrong image size!")
          val w = idx % params.imagesPerRow
          val h = idx / params.imagesPerRow
          finalImage.createGraphics().drawImage(
            image, params.slideWidth * w, params.slideHeight * h, null)
      }
      Some(finalImage)
    }
  }

  def convertToType(sourceImage: BufferedImage, targetType: Int): BufferedImage = {
    sourceImage.getType() match {
      case e if e == targetType =>
        sourceImage
      case _ =>
        val image = new BufferedImage(sourceImage.getWidth(),
          sourceImage.getHeight(), targetType)
        image.getGraphics().drawImage(sourceImage, 0, 0, null)
        image
    }
  }

  def createBufferedImageFromBytes(b: Array[Byte], targetType: Int, params: ImageCreatorParameters): Option[BufferedImage] = {
    try {
      val bufferedImage = new BufferedImage(params.slideWidth, params.slideHeight, targetType)
      bufferedImage.setRGB(0, 0, params.slideWidth, params.slideHeight, b.map { v =>
        val i = 0xff & v.asInstanceOf[Int]
        new Color(i, i, i).getRGB
      }, 0, params.slideWidth)
      Some(bufferedImage)
    } catch {
      case e: IOException =>
        e.printStackTrace()
        None
    }
  }
}
