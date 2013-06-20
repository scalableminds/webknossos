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

case class ImagePartInfo(page: Int, x: Int, y: Int, height: Int, width: Int)

case class PageInfo(idx: Int, start: Int, number: Int){
  def name = idx + ".png"
}

case class CombinedImage(pages: List[CombinedPage])

case class CombinedPage(image: BufferedImage, info: List[ImagePartInfo], pageInfo: PageInfo)

case class ImageCreatorParameters(
  slideWidth: Int = 128,
  slideHeight: Int = 128,
  imagesPerRow: Int = 8,
  imagesPerColumn: Int = Int.MaxValue,
  imageWidth: Option[Int] = None,
  imageHeight: Option[Int] = None)

object ImageCreator {

  val targetType = BufferedImage.TYPE_3BYTE_BGR

  def createImage(data: Array[Byte], params: ImageCreatorParameters): Option[CombinedImage] = {
    val images = calculateImageSlices(data, params)
    // TODO: Fix
    createBigImages(images, params)
  }

  def calculateImageSlices(data: Array[Byte], params: ImageCreatorParameters): List[BufferedImage] = {
    val targetType = BufferedImage.TYPE_3BYTE_BGR
    data.sliding(params.slideHeight * params.slideWidth, params.slideHeight * params.slideWidth).toList.flatMap { slice =>
      createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  def createBigImages(images: List[BufferedImage], params: ImageCreatorParameters): Option[CombinedImage] = {
    if (images.isEmpty) {
      Logger.warn("No images supplied")
      None
    } else {
      val subpartWidth = images(0).getWidth()
      val subpartHeight = images(0).getHeight()
      val imageType = images(0).getType()
      val imagesPerPage = params.imagesPerColumn * params.imagesPerRow
      val pages = images.sliding(imagesPerPage,imagesPerPage).zipWithIndex.map{ 
        case (pageImages, page) =>
          val depth = math.ceil(pageImages.size.toFloat / params.imagesPerRow).toInt
        
          val imageWidth = params.imageWidth.getOrElse(subpartWidth * params.imagesPerRow)
          val imageHeight = params.imageHeight.getOrElse(subpartHeight * depth)
    
          val finalImage = new BufferedImage(imageWidth, imageHeight, imageType)
    
          val info = pageImages.zipWithIndex.map {
            case (image, idx) =>
              assert(image.getWidth() == subpartWidth, "Wrong image size!")
              assert(image.getHeight() == subpartHeight, "Wrong image size!")
              val w = idx % params.imagesPerRow * params.slideWidth
              val h = idx / params.imagesPerRow * params.slideHeight 
              finalImage.createGraphics().drawImage(
                image,  w, h, null)
              ImagePartInfo(page, w, h, subpartWidth, subpartHeight)
          }
          CombinedPage(finalImage, info, PageInfo(page, page*imagesPerPage, pageImages.size))
      }.toList
      Some(CombinedImage(pages))
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
