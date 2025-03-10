package com.scalableminds.webknossos.datastore.image

import com.scalableminds.util.image.Color
import com.typesafe.scalalogging.LazyLogging

import java.awt.image.BufferedImage
import java.io.IOException
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

case class ImagePartInfo(page: Int, x: Int, y: Int, height: Int, width: Int)

case class PageInfo(idx: Int, start: Int, number: Int) {
  def name: Int = idx
}

case class CombinedImage(pages: List[CombinedPage])

case class CombinedPage(image: BufferedImage, info: List[ImagePartInfo], pageInfo: PageInfo)

case class ImageCreatorParameters(
    elementClass: ElementClass.Value,
    useHalfBytes: Boolean,
    slideWidth: Int = 128,
    slideHeight: Int = 128,
    imagesPerRow: Int = 8,
    imagesPerColumn: Int = Int.MaxValue,
    imageWidth: Option[Int] = None,
    imageHeight: Option[Int] = None,
    intensityRange: Option[(Double, Double)] = None,
    blackAndWhite: Boolean,
    isSegmentation: Boolean = false,
    color: Option[Color] = None,
    invertColor: Option[Boolean] = None
)

object ImageCreator extends LazyLogging {

  private val defaultTargetType = BufferedImage.TYPE_3BYTE_BGR

  def spriteSheetFor(data: Array[Byte], params: ImageCreatorParameters): Option[CombinedImage] = {
    val targetType = defaultTargetType
    val images = calculateSprites(data, params, targetType)
    createSpriteSheet(images, params, targetType)
  }

  private def calculateSprites(data: Array[Byte],
                               params: ImageCreatorParameters,
                               targetType: Int): List[BufferedImage] = {
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

    val slidingSize = params.slideHeight * params.slideWidth * ElementClass.bytesPerElement(params.elementClass)
    imageData.sliding(slidingSize, slidingSize).toList.flatMap { slice =>
      createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  private def createSpriteSheet(bufferedImages: List[BufferedImage],
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

  private def toRGBArray(b: Array[Byte],
                         elementClass: ElementClass.Value,
                         isSegmentation: Boolean,
                         intensityRangeOpt: Option[(Double, Double)],
                         color: Option[Color],
                         invertColor: Boolean) = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val colored = new Array[Int](b.length / bytesPerElement)
    var idx = 0
    val l = b.length
    val intensityRange = intensityRangeOpt.getOrElse(ElementClass.defaultIntensityRange(elementClass))
    while (idx + bytesPerElement <= l) {
      colored(idx / bytesPerElement) = {
        if (isSegmentation)
          idToRGB(b(idx))
        else {
          val colorRed = applyColor(color.map(_.r).getOrElse(1d), invertColor)
          val colorGreen = applyColor(color.map(_.g).getOrElse(1d), invertColor)
          val colorBlue = applyColor(color.map(_.b).getOrElse(1d), invertColor)
          val grayNormalized = elementClass match {
            case ElementClass.uint8 =>
              normalizeIntensityUint8(intensityRange, b(idx))
            case ElementClass.int8 =>
              normalizeIntensityInt8(intensityRange, b(idx))
            case ElementClass.uint16 =>
              normalizeIntensityUint16(intensityRange, b(idx), b(idx + 1))
            case ElementClass.int16 =>
              normalizeIntensityInt16(intensityRange, b(idx), b(idx + 1))
            case ElementClass.uint24 => // assume uint24 rgb color data
              b(idx).toInt // The color data is handled below
            case ElementClass.uint32 =>
              normalizeIntensityUint32(intensityRange, b(idx), b(idx + 1), b(idx + 2), b(idx + 3))
            case ElementClass.int32 =>
              normalizeIntensityInt32(intensityRange, b(idx), b(idx + 1), b(idx + 2), b(idx + 3))
            case ElementClass.uint64 =>
              normalizeIntensityUint64(intensityRange,
                                       b(idx),
                                       b(idx + 1),
                                       b(idx + 2),
                                       b(idx + 3),
                                       b(idx + 4),
                                       b(idx + 5),
                                       b(idx + 6),
                                       b(idx + 7))
            case ElementClass.int64 =>
              normalizeIntensityInt64(intensityRange,
                                      b(idx),
                                      b(idx + 1),
                                      b(idx + 2),
                                      b(idx + 3),
                                      b(idx + 4),
                                      b(idx + 5),
                                      b(idx + 6),
                                      b(idx + 7))
            case ElementClass.float =>
              normalizeIntensityFloat(intensityRange, b(idx), b(idx + 1), b(idx + 2), b(idx + 3))
            case _ =>
              throw new Exception(s"Unsupported ElementClass for color layer thumbnail: $elementClass")
          }
          elementClass match {
            case ElementClass.uint24 => // assume uint24 rgb color data
              (0xFF << 24) | ((b(idx) & 0xFF) << 16) | ((b(idx + 1) & 0xFF) << 8) | ((b(idx + 2) & 0xFF) << 0)
            case _ =>
              (0xFF << 24) | (colorRed(grayNormalized) << 16) | (colorGreen(grayNormalized) << 8) | (colorBlue(
                grayNormalized) << 0)
          }
        }
      }
      idx += bytesPerElement
    }
    colored
  }

  private def applyColor(colorFactor: Double, invertColor: Boolean): Int => Int =
    if (invertColor)
      (valueByte: Int) => (Math.abs(valueByte - 255) * colorFactor).toInt & 0xFF
    else
      (valueByte: Int) => (valueByte * colorFactor).toInt & 0xFF

  private def normalizeIntensityUint8(intensityRange: (Double, Double), grayByte: Byte): Int =
    normalizeIntensityImpl((grayByte & 0xFF).toDouble, intensityRange)

  private def normalizeIntensityInt8(intensityRange: (Double, Double), grayByte: Byte): Int =
    normalizeIntensityImpl(grayByte.toDouble, intensityRange)

  private def normalizeIntensityUint16(intensityRange: (Double, Double),
                                       grayLowerByte: Byte,
                                       grayUpperByte: Byte): Int = {
    val grayInt = ((grayUpperByte & 0xFF) << 8) | (grayLowerByte & 0xFF)
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }

  private def normalizeIntensityInt16(intensityRange: (Double, Double),
                                      grayLowerByte: Byte,
                                      grayUpperByte: Byte): Int = {
    val grayInt = ((grayUpperByte << 8) | (grayLowerByte & 0xFF)).toShort.toInt
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }

  private def normalizeIntensityUint32(intensityRange: (Double, Double),
                                       byte0: Byte,
                                       byte1: Byte,
                                       byte2: Byte,
                                       byte3: Byte): Int = {
    val grayLong = ((byte3 & 0xFFL) << 24) | ((byte2 & 0xFFL) << 16) | ((byte1 & 0xFFL) << 8) | (byte0 & 0xFFL)
    normalizeIntensityImpl(grayLong.toDouble, intensityRange)

  }

  private def normalizeIntensityInt32(intensityRange: (Double, Double),
                                      byte0: Byte,
                                      byte1: Byte,
                                      byte2: Byte,
                                      byte3: Byte): Int = {
    val grayInt = ((byte3 & 0xFF) << 24) | ((byte2 & 0xFF) << 16) | ((byte1 & 0xFF) << 8) | (byte0 & 0xFF)
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }
  private def normalizeIntensityUint64(intensityRange: (Double, Double),
                                       byte0: Byte,
                                       byte1: Byte,
                                       byte2: Byte,
                                       byte3: Byte,
                                       byte4: Byte,
                                       byte5: Byte,
                                       byte6: Byte,
                                       byte7: Byte): Int = {
    val graySignedLong = ((byte7 & 0xFFL) << 56) | ((byte6 & 0xFFL) << 48) | ((byte5 & 0xFFL) << 40) | ((byte4 & 0xFFL) << 32) | ((byte3 & 0xFFL) << 24) | ((byte2 & 0xFFL) << 16) | ((byte1 & 0xFFL) << 8) | (byte0 & 0xFFL)
    val grayUnsignedDouble =
      if (graySignedLong >= 0) graySignedLong.toDouble
      else (graySignedLong & 0x7FFFFFFFFFFFFFFFL).toDouble + 0x8000000000000000L.toDouble
    normalizeIntensityImpl(grayUnsignedDouble, intensityRange)
  }

  private def normalizeIntensityInt64(intensityRange: (Double, Double),
                                      byte0: Byte,
                                      byte1: Byte,
                                      byte2: Byte,
                                      byte3: Byte,
                                      byte4: Byte,
                                      byte5: Byte,
                                      byte6: Byte,
                                      byte7: Byte): Int = {
    val graySignedLong = ((byte7 & 0xFFL) << 56) | ((byte6 & 0xFFL) << 48) | ((byte5 & 0xFFL) << 40) | ((byte4 & 0xFFL) << 32) | ((byte3 & 0xFFL) << 24) | ((byte2 & 0xFFL) << 16) | ((byte1 & 0xFFL) << 8) | (byte0 & 0xFFL)
    normalizeIntensityImpl(graySignedLong.toDouble, intensityRange)
  }

  private def normalizeIntensityFloat(intensityRange: (Double, Double),
                                      byte0: Byte,
                                      byte1: Byte,
                                      byte2: Byte,
                                      byte3: Byte): Int = {
    val grayInt = ((byte3 & 0xFF) << 24) | ((byte2 & 0xFF) << 16) | ((byte1 & 0xFF) << 8) | (byte0 & 0xFF)
    normalizeIntensityImpl(java.lang.Float.intBitsToFloat(grayInt).toDouble, intensityRange)
  }

  private def normalizeIntensityImpl(value: Double, intensityRange: (Double, Double)): Int =
    Math
      .round(
        com.scalableminds.util.tools.Math.clamp(
          (com.scalableminds.util.tools.Math
            .clamp(value, intensityRange._1, intensityRange._2) - intensityRange._1) / (intensityRange._2 - intensityRange._1) * 255.0,
          0,
          255
        ))
      .toInt

  private def idToRGB(b: Byte) = {
    def hueToRGB(h: Double): Int = {

      val i: Double = Math.floor(h * 6f)
      val f: Double = h * 6f - i

      val (r, g, b) = i % 6 match {
        case 0 => (1.0, f, 0.0)
        case 1 => (1.0 - f, 1.0, 0.0)
        case 2 => (0.0, 1.0, f)
        case 3 => (0.0, 1.0 - f, 1.0)
        case 4 => (f, 0.0, 1.0)
        case 5 => (1.0, 0.0, 1.0 - f)
      }

      val rByte = (r * 255).toByte
      val gByte = (g * 255).toByte
      val bByte = (b * 255).toByte
      (0xFF << 24) | ((rByte & 0xFF) << 16) | ((gByte & 0xFF) << 8) | ((bByte & 0xFF) << 0)
    }

    b match {
      case 0 => (0x64 << 24) | (0x64 << 16) | (0x64 << 8) | (0x64 << 0)
      case _ =>
        val golden_ratio = 0.618033988749895
        val hue = ((b & 0xFF) * golden_ratio) % 1.0
        hueToRGB(hue)
    }
  }

  private def createBufferedImageFromBytes(b: Array[Byte],
                                           targetType: Int,
                                           params: ImageCreatorParameters): Option[BufferedImage] =
    try {
      val bufferedImage = new BufferedImage(params.slideWidth, params.slideHeight, targetType)
      bufferedImage.setRGB(
        0,
        0,
        params.slideWidth,
        params.slideHeight,
        toRGBArray(b,
                   params.elementClass,
                   params.isSegmentation,
                   params.intensityRange,
                   params.color,
                   params.invertColor.getOrElse(false)),
        0,
        params.slideWidth
      )
      Some(bufferedImage)
    } catch {
      case e: IOException =>
        logger.error("IOException while converting byte array to buffered image.", e)
        None
    }
}
