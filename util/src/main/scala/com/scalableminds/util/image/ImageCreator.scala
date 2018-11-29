package com.scalableminds.util.image

import java.awt.image.BufferedImage
import java.io.IOException

import com.typesafe.scalalogging.LazyLogging

case class ImagePartInfo(page: Int, x: Int, y: Int, height: Int, width: Int)

case class PageInfo(idx: Int, start: Int, number: Int) {
  def name = idx
}

case class CombinedImage(pages: List[CombinedPage])

case class CombinedPage(image: BufferedImage, info: List[ImagePartInfo], pageInfo: PageInfo)

case class ImageCreatorParameters(
    bytesPerElement: Int,
    useHalfBytes: Boolean,
    slideWidth: Int = 128,
    slideHeight: Int = 128,
    imagesPerRow: Int = 8,
    imagesPerColumn: Int = Int.MaxValue,
    imageWidth: Option[Int] = None,
    imageHeight: Option[Int] = None,
    blackAndWhite: Boolean
)

object ImageCreator extends LazyLogging {

  val defaultTargetType = BufferedImage.TYPE_3BYTE_BGR

  def spriteSheetFor(data: Array[Byte], params: ImageCreatorParameters): Option[CombinedImage] = {
    val targetType = defaultTargetType
    val images = calculateSprites(data, params, targetType)
    createSpriteSheet(images, params, targetType)
  }

  def calculateSprites(data: Array[Byte], params: ImageCreatorParameters, targetType: Int): List[BufferedImage] = {
    val imageData =
      if (params.useHalfBytes) {
        val r = new Array[Byte](data.length * 2)
        data.zipWithIndex.foreach {
          case (b, idx) =>
            r(2 * idx) = (b & 0xF0).toByte
            r(2 * idx + 1) = (b & 0x0F << 4).toByte
        }
        r
      } else if (params.blackAndWhite) {
        data.map(d => if (d != 0x00) 0xFF.toByte else 0x00.toByte)
      } else
        data

    val slidingSize = params.slideHeight * params.slideWidth * params.bytesPerElement
    imageData.sliding(slidingSize, slidingSize).toList.flatMap { slice =>
      createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  def createSpriteSheet(bufferedImages: List[BufferedImage],
                        params: ImageCreatorParameters,
                        targetType: Int): Option[CombinedImage] =
    if (bufferedImages.isEmpty) {
      logger.warn("No images supplied for sprite sheet generation.")
      None
    } else {
      val subpartWidth = params.slideWidth
      val subpartHeight = params.slideHeight

      val imagesPerPage = math.min(params.imagesPerColumn.toLong * params.imagesPerRow, Int.MaxValue).toInt
      val pages = bufferedImages
        .sliding(imagesPerPage, imagesPerPage)
        .zipWithIndex
        .map {
          case (pageImages, page) =>
            val depth = math.ceil(pageImages.size.toFloat / params.imagesPerRow).toInt
            val imageWidth = params.imageWidth.getOrElse(subpartWidth * params.imagesPerRow)
            val imageHeight = params.imageHeight.getOrElse(subpartHeight * depth)

            val finalImage = new BufferedImage(imageWidth, imageHeight, targetType)

            val info = pageImages.zipWithIndex.map {
              case (image, idx) =>
                assert(image.getWidth() == subpartWidth, "Wrong image size!")
                assert(image.getHeight() == subpartHeight, "Wrong image size!")
                val w = idx % params.imagesPerRow * params.slideWidth
                val h = idx / params.imagesPerRow * params.slideHeight
                finalImage.createGraphics().drawImage(image, w, h, null)
                ImagePartInfo(page, w, h, subpartHeight, subpartWidth)
            }
            CombinedPage(finalImage, info, PageInfo(page, page * imagesPerPage, pageImages.size))
        }
        .toList
      Some(CombinedImage(pages))
    }

  def convertToType(sourceImage: BufferedImage, targetType: Int): BufferedImage =
    sourceImage.getType() match {
      case e if e == targetType =>
        sourceImage
      case _ =>
        val image = new BufferedImage(sourceImage.getWidth(), sourceImage.getHeight(), targetType)
        image.getGraphics().drawImage(sourceImage, 0, 0, null)
        image
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
            (b(idx + 1) << 24) | ((gray & 0xFF) << 16) | ((gray & 0xFF) << 8) | ((gray & 0xFF) << 0)
          case 3 =>
            (0xFF << 24) | ((b(idx) & 0xFF) << 16) | ((b(idx + 1) & 0xFF) << 8) | ((b(idx + 2) & 0xFF) << 0)
          case 4 =>
            toTestRGB(b(idx))
          //((b(idx + 3) & 0xFF) << 24) | ((b(idx) & 0xFF) << 16) | ((b(idx + 1) & 0xFF) << 8) | ((b(idx + 2) & 0xFF) << 0)
          case _ =>
            throw new Exception("Can't handle " + bytesPerElement + " bytes per element in Image creator.")
        }
      }
      idx += bytesPerElement
    }
    colored
  }

  def hsvToRgb(hsv: Array[Double]): Int = {
    val K = Array(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0)
    val p = Array.ofDim[Double](3)
    for (i <- 0 to 2) {
      val x = hsv(0) + K(i)
      val decimal = x.toInt
      val fract = x - decimal
      p(i) = Math.abs(fract * 6.0 - K(3))
    }
    val returnVal = Array.ofDim[Double](3)
    for (i <- 0 to 2) {
      val x = K(0)
      val cl = com.scalableminds.util.tools.Math.clamp(p(i) - K(0), 0.0, 1.0)
      val ret = x * (1 - hsv(1)) + cl * hsv(1)
      returnVal(i) = hsv(2) * ret
    }
    val end = returnVal.map(x => (x * 255).toByte)
    (0xFF << 24) | ((end(0) & 0xFF) << 16) | ((end(1) & 0xFF) << 8) | ((end(2) & 0xFF) << 0)
  }

  def toTestRGB(b: Byte) =
    b match {
      case 0 => (0x64 << 24) | (0x64 << 16) | (0x64 << 8) | (0x64 << 0)
      case _ =>
        val golden_ratio = 0.618033988749895
        val value = ((b & 0xFF) * golden_ratio) % 1.0
        hsvToRgb(Array(value, 1.0, 1.0, 1.0))
    }

  def createBufferedImageFromBytes(b: Array[Byte],
                                   targetType: Int,
                                   params: ImageCreatorParameters): Option[BufferedImage] =
    try {
      val bufferedImage = new BufferedImage(params.slideWidth, params.slideHeight, targetType)
      bufferedImage.setRGB(0,
                           0,
                           params.slideWidth,
                           params.slideHeight,
                           toRGBArray(b, params.bytesPerElement),
                           0,
                           params.slideWidth)
      Some(bufferedImage)
    } catch {
      case e: IOException =>
        logger.error("IOException while converting byte array to buffered image.", e)
        None
    }
}
