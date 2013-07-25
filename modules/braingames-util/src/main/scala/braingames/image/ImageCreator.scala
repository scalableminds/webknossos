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
import java.awt.{Color => JColor}
import akka.pattern.ask
import braingames.geometry.Point3D
import akka.util.Timeout
import akka.pattern.AskTimeoutException
import braingames.geometry.Vector3D
import scala.concurrent.duration._
import scala.concurrent.Promise
import scala.collection.mutable.ArrayBuffer

case class ImagePartInfo(x: Int, y: Int, height: Int, width: Int)

case class CombinedImage(image: BufferedImage, info: List[ImagePartInfo])

case class ImageCreatorParameters(
  bytesPerElement: Int,
  slideWidth: Int = 128,
  slideHeight: Int = 128,
  imagesPerRow: Int = 8,
  imageWidth: Option[Int] = None,
  imageHeight: Option[Int] = None)

object ImageCreator {

  val defaultTargetType = BufferedImage.TYPE_3BYTE_BGR

  def createImage(data: Array[Byte], params: ImageCreatorParameters): Option[CombinedImage] = {
    val targetType = defaultTargetType
    val images = calculateImageSlices(data, params, targetType)
    createBigImage(images, params, targetType)
  }

  def calculateImageSlices(data: Array[Byte], params: ImageCreatorParameters, targetType: Int): List[BufferedImage] = {
    val slidingSize = params.slideHeight * params.slideWidth * params.bytesPerElement
    data.sliding(slidingSize, slidingSize).toList.flatMap {
      slice =>
        createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  def createBigImage(bufferedImages: List[BufferedImage], params: ImageCreatorParameters, targetType: Int): Option[CombinedImage] = {
    if (bufferedImages.isEmpty) {
      None
    } else {
      val subpartWidth = params.slideWidth
      val subpartHeight = params.slideHeight
      val depth = math.ceil(bufferedImages.size.toFloat / params.imagesPerRow).toInt
      val imageWidth = params.imageWidth.getOrElse(subpartWidth * params.imagesPerRow)
      val imageHeight = params.imageHeight.getOrElse(subpartHeight * depth)

      val finalImage = new BufferedImage(imageWidth, imageHeight, targetType)

      val info = bufferedImages.zipWithIndex.map {
        case (image, idx) =>
          assert(image.getWidth() == subpartWidth, "Wrong image size!")
          assert(image.getHeight() == subpartHeight, "Wrong image size!")
          val w = idx % params.imagesPerRow * params.slideWidth
          val h = idx / params.imagesPerRow * params.slideHeight
          finalImage.createGraphics().drawImage(
            image, w, h, null)
          ImagePartInfo(w, h, subpartWidth, subpartHeight)
      }
      Some(CombinedImage(finalImage, info))
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

  def toRGBArray(b: Array[Byte], bytesPerElement: Int) = {
    val colored = new Array[Int](b.length / bytesPerElement)
    var idx = 0
    val l = b.length
    while (idx + bytesPerElement <= l) {
      colored(idx / bytesPerElement) = {
        bytesPerElement match {
          case 1 =>
            val gray = b(idx)
            (0xFF << 24) | ((gray & 0xFF) << 16) | ((gray & 0xFF) << 8) | ((gray & 0xFF) << 0)
          case 2 =>
            val gray = b(idx)
            (b(idx+1) << 24) | ((gray & 0xFF) << 16) | ((gray & 0xFF) << 8) | ((gray & 0xFF) << 0)
          case 3 =>
            (0xFF << 24) | ((b(idx) & 0xFF) << 16) | ((b(idx + 1) & 0xFF) << 8) | ((b(idx + 2) & 0xFF) << 0)
          case 4 =>
            ((b(idx + 3) & 0xFF) << 24) | ((b(idx) & 0xFF) << 16) | ((b(idx + 1) & 0xFF) << 8) | ((b(idx + 2) & 0xFF) << 0)
          case _ =>
            throw new Exception("Can't handle " + bytesPerElement + " bytes per element in Image creator.")
        }
      }
      idx += bytesPerElement
    }
    colored
  }

  def createBufferedImageFromBytes(b: Array[Byte], targetType: Int, params: ImageCreatorParameters): Option[BufferedImage] = {
    try {
      val bufferedImage = new BufferedImage(params.slideWidth, params.slideHeight, targetType)
      bufferedImage.setRGB(0, 0, params.slideWidth, params.slideHeight, toRGBArray(b, params.bytesPerElement), 0, params.slideWidth)
      Some(bufferedImage)
    } catch {
      case e: IOException =>
        e.printStackTrace()
        None
    }
  }
}
