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
    invertColor: Option[Boolean] = None,
    // When true, render into an alpha-capable image: segmentation id 0 becomes fully transparent
    // and every other pixel's alpha is derived from `opacity`, instead of always being fully opaque.
    // Used when compositing multiple layers on top of each other (see BinaryDataController.thumbnailCombinedJpeg).
    preserveAlpha: Boolean = false,
    opacity: Double = 100
)

object ImageCreator extends LazyLogging {

  private val defaultTargetType = BufferedImage.TYPE_3BYTE_BGR

  def spriteSheetFor(data: Array[Byte], params: ImageCreatorParameters): Option[CombinedImage] = {
    val targetType = if (params.preserveAlpha) BufferedImage.TYPE_INT_ARGB else defaultTargetType
    val images = calculateSprites(data, params, targetType)
    createSpriteSheet(images, params, targetType)
  }

  private def calculateSprites(
      data: Array[Byte],
      params: ImageCreatorParameters,
      targetType: Int
  ): List[BufferedImage] = {
    val imageData =
      if (params.useHalfBytes) {
        val r = new Array[Byte](data.length * 2)
        data.zipWithIndex.foreach { case (b, idx) =>
          r(2 * idx) = (b & 0xf0).toByte
          r(2 * idx + 1) = (b & 0x0f << 4).toByte
        }
        r
      } else if (params.blackAndWhite) {
        data.map(d => if (d != 0x00) 0xff.toByte else 0x00.toByte)
      } else
        data

    val slidingSize = params.slideHeight * params.slideWidth * ElementClass.bytesPerElement(params.elementClass)
    imageData.sliding(slidingSize, slidingSize).toList.flatMap { slice =>
      createBufferedImageFromBytes(slice, targetType, params)
    }
  }

  private def createSpriteSheet(
      bufferedImages: List[BufferedImage],
      params: ImageCreatorParameters,
      targetType: Int
  ): Option[CombinedImage] =
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
        .map { case (pageImages, page) =>
          val depth = math.ceil(pageImages.size.toFloat / params.imagesPerRow).toInt
          val imageWidth = params.imageWidth.getOrElse(subpartWidth * params.imagesPerRow)
          val imageHeight = params.imageHeight.getOrElse(subpartHeight * depth)

          val finalImage = new BufferedImage(imageWidth, imageHeight, targetType)

          val info = pageImages.zipWithIndex.map { case (image, idx) =>
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

  private def toRGBArray(
      b: Array[Byte],
      elementClass: ElementClass.Value,
      isSegmentation: Boolean,
      intensityRangeOpt: Option[(Double, Double)],
      color: Option[Color],
      invertColor: Boolean,
      preserveAlpha: Boolean,
      opacity: Double
  ) = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val colored = new Array[Int](b.length / bytesPerElement)
    var idx = 0
    val l = b.length
    val intensityRange = intensityRangeOpt.getOrElse(ElementClass.defaultIntensityRange(elementClass))
    val opacityAlphaByte =
      Math.round(com.scalableminds.util.tools.MathUtils.clamp(opacity, 0d, 100d) / 100.0 * 255).toInt & 0xff
    while (idx + bytesPerElement <= l) {
      colored(idx / bytesPerElement) =
        if (isSegmentation)
          idToRGB(readSegmentId(b, idx, bytesPerElement), preserveAlpha, opacityAlphaByte)
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
              normalizeIntensityUint64(
                intensityRange,
                b(idx),
                b(idx + 1),
                b(idx + 2),
                b(idx + 3),
                b(idx + 4),
                b(idx + 5),
                b(idx + 6),
                b(idx + 7)
              )
            case ElementClass.int64 =>
              normalizeIntensityInt64(
                intensityRange,
                b(idx),
                b(idx + 1),
                b(idx + 2),
                b(idx + 3),
                b(idx + 4),
                b(idx + 5),
                b(idx + 6),
                b(idx + 7)
              )
            case ElementClass.float =>
              normalizeIntensityFloat(intensityRange, b(idx), b(idx + 1), b(idx + 2), b(idx + 3))
            case _ =>
              throw new Exception(s"Unsupported ElementClass for color layer thumbnail: $elementClass")
          }
          elementClass match {
            case ElementClass.uint24 => // assume uint24 rgb color data
              (opacityAlphaByte << 24) | ((b(idx) & 0xff) << 16) | ((b(idx + 1) & 0xff) << 8) | ((b(
                idx + 2
              ) & 0xff) << 0)
            case _ =>
              (opacityAlphaByte << 24) | (colorRed(grayNormalized) << 16) | (colorGreen(grayNormalized) << 8) | (
                colorBlue(grayNormalized) << 0
              )
          }
        }
      idx += bytesPerElement
    }
    colored
  }

  private def applyColor(colorFactor: Double, invertColor: Boolean): Int => Int =
    if (invertColor)
      (valueByte: Int) => (Math.abs(valueByte - 255) * colorFactor).toInt & 0xff
    else
      (valueByte: Int) => (valueByte * colorFactor).toInt & 0xff

  private def normalizeIntensityUint8(intensityRange: (Double, Double), grayByte: Byte): Int =
    normalizeIntensityImpl((grayByte & 0xff).toDouble, intensityRange)

  private def normalizeIntensityInt8(intensityRange: (Double, Double), grayByte: Byte): Int =
    normalizeIntensityImpl(grayByte.toDouble, intensityRange)

  private def normalizeIntensityUint16(
      intensityRange: (Double, Double),
      grayLowerByte: Byte,
      grayUpperByte: Byte
  ): Int = {
    val grayInt = ((grayUpperByte & 0xff) << 8) | (grayLowerByte & 0xff)
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }

  private def normalizeIntensityInt16(
      intensityRange: (Double, Double),
      grayLowerByte: Byte,
      grayUpperByte: Byte
  ): Int = {
    val grayInt = ((grayUpperByte << 8) | (grayLowerByte & 0xff)).toShort.toInt
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }

  private def normalizeIntensityUint32(
      intensityRange: (Double, Double),
      byte0: Byte,
      byte1: Byte,
      byte2: Byte,
      byte3: Byte
  ): Int = {
    val grayLong = ((byte3 & 0xffL) << 24) | ((byte2 & 0xffL) << 16) | ((byte1 & 0xffL) << 8) | (byte0 & 0xffL)
    normalizeIntensityImpl(grayLong.toDouble, intensityRange)

  }

  private def normalizeIntensityInt32(
      intensityRange: (Double, Double),
      byte0: Byte,
      byte1: Byte,
      byte2: Byte,
      byte3: Byte
  ): Int = {
    val grayInt = ((byte3 & 0xff) << 24) | ((byte2 & 0xff) << 16) | ((byte1 & 0xff) << 8) | (byte0 & 0xff)
    normalizeIntensityImpl(grayInt.toDouble, intensityRange)
  }
  private def normalizeIntensityUint64(
      intensityRange: (Double, Double),
      byte0: Byte,
      byte1: Byte,
      byte2: Byte,
      byte3: Byte,
      byte4: Byte,
      byte5: Byte,
      byte6: Byte,
      byte7: Byte
  ): Int = {
    val graySignedLong =
      ((byte7 & 0xffL) << 56) | ((byte6 & 0xffL) << 48) | ((byte5 & 0xffL) << 40) | ((byte4 & 0xffL) << 32) | ((byte3 & 0xffL) << 24) | ((byte2 & 0xffL) << 16) | ((byte1 & 0xffL) << 8) | (byte0 & 0xffL)
    val grayUnsignedDouble =
      if (graySignedLong >= 0) graySignedLong.toDouble
      else (graySignedLong & 0x7fffffffffffffffL).toDouble + 0x8000000000000000L.toDouble
    normalizeIntensityImpl(grayUnsignedDouble, intensityRange)
  }

  private def normalizeIntensityInt64(
      intensityRange: (Double, Double),
      byte0: Byte,
      byte1: Byte,
      byte2: Byte,
      byte3: Byte,
      byte4: Byte,
      byte5: Byte,
      byte6: Byte,
      byte7: Byte
  ): Int = {
    val graySignedLong =
      ((byte7 & 0xffL) << 56) | ((byte6 & 0xffL) << 48) | ((byte5 & 0xffL) << 40) | ((byte4 & 0xffL) << 32) | ((byte3 & 0xffL) << 24) | ((byte2 & 0xffL) << 16) | ((byte1 & 0xffL) << 8) | (byte0 & 0xffL)
    normalizeIntensityImpl(graySignedLong.toDouble, intensityRange)
  }

  private def normalizeIntensityFloat(
      intensityRange: (Double, Double),
      byte0: Byte,
      byte1: Byte,
      byte2: Byte,
      byte3: Byte
  ): Int = {
    val grayInt = ((byte3 & 0xff) << 24) | ((byte2 & 0xff) << 16) | ((byte1 & 0xff) << 8) | (byte0 & 0xff)
    normalizeIntensityImpl(java.lang.Float.intBitsToFloat(grayInt).toDouble, intensityRange)
  }

  private def normalizeIntensityImpl(value: Double, intensityRange: (Double, Double)): Int =
    Math
      .round(
        com.scalableminds.util.tools.MathUtils.clamp(
          (com.scalableminds.util.tools.MathUtils.clamp(
            value,
            intensityRange._1,
            intensityRange._2
          ) - intensityRange._1) / (intensityRange._2 - intensityRange._1) * 255.0,
          0.0,
          255.0
        )
      )
      .toInt

  // Reads the full (little-endian) segment id at `idx`, up to 8 bytes. Kept as a raw 64-bit bit
  // pattern (not sign-extended/interpreted) since idToRGB only ever extracts sub-ranges of bits from
  // it, mirroring how the frontend treats segment ids as unsigned 64-bit values.
  private def readSegmentId(b: Array[Byte], idx: Int, bytesPerElement: Int): Long = {
    var result = 0L
    var i = 0
    while (i < bytesPerElement) {
      result |= (b(idx + i) & 0xffL) << (8 * i)
      i += 1
    }
    result
  }

  // Segment color permutation table parameters, matching the frontend exactly
  // (frontend/javascripts/viewer/shaders/segmentation.glsl.ts, `color: buildPermutation(19, 2)`).
  private val ColorPermutationSequenceLength = 19
  private val ColorPermutationPrimitiveRoot = 2

  // Rounds to float32 precision, mirroring the frontend's `imprecise` helper
  // (frontend/javascripts/viewer/shaders/utils.glsl.ts), which keeps this JS/Scala port consistent
  // with the GLSL shader's own (32-bit float) arithmetic.
  private def imprecise(x: Double): Double = x.toFloat.toDouble

  private def glslPow(x: Double, y: Double): Double = {
    val log2x = imprecise(Math.log(x) / Math.log(2))
    imprecise(Math.pow(2, y * log2x))
  }

  // Port of jsGetElementOfPermutation (frontend/javascripts/viewer/shaders/utils.glsl.ts): a
  // pseudo-random permutation of 1..sequenceLength, built from powers of a primitive root modulo
  // sequenceLength.
  private def getElementOfPermutation(index: Int, sequenceLength: Int, primitiveRoot: Int): Int = {
    val oneBasedIndex = (index % sequenceLength) + 1
    if (oneBasedIndex == 1) sequenceLength
    else (Math.floor(glslPow(primitiveRoot, oneBasedIndex)).toLong % sequenceLength).toInt
  }

  // Port of jsColormapJet (frontend/javascripts/viewer/shaders/utils.glsl.ts): the "jet" colormap,
  // input and output channels in [0, 1].
  private def colormapJet(x: Double): (Double, Double, Double) = {
    def clamp01(v: Double): Double = Math.max(0d, Math.min(1d, v))
    val r = clamp01(if (x < 0.89) (x - 0.35) / 0.31 else 1.0 - ((x - 0.89) / 0.11) * 0.5)
    val g = clamp01(if (x < 0.64) (x - 0.125) * 4.0 else 1.0 - (x - 0.64) / 0.27)
    val bl = clamp01(if (x < 0.34) 0.5 + (x * 0.5) / 0.11 else 1.0 - (x - 0.34) / 0.31)
    (r, g, bl)
  }

  // Port of jsConvertCellIdToRGBA (frontend/javascripts/viewer/shaders/segmentation.glsl.ts), the
  // same formula the frontend uses to color segments in the viewer, segment list, and meshes, so
  // that thumbnails use matching colors. Does not replicate the GLSL dataviewport shader's
  // additional stripe/grid pattern overlay, which is a purely visual GPU feature with no JS/color
  // equivalent.
  private def idToRGB(id: Long, preserveAlpha: Boolean, opacityAlphaByte: Int): Int =
    if (id == 0L) {
      // Background/unlabeled segment id: transparent when compositing multiple layers, otherwise the
      // established solid-gray look of the standalone per-layer segmentation thumbnail.
      if (preserveAlpha) 0
      else (0x64 << 24) | (0x64 << 16) | (0x64 << 8) | (0x64 << 0)
    } else {
      val significantSegmentIndex = ((id & 0xffffL) + ((id >>> 32) & 0xffffL)).toInt
      val colorIndex =
        getElementOfPermutation(significantSegmentIndex, ColorPermutationSequenceLength, ColorPermutationPrimitiveRoot)
      val colorValueDecimal = colorIndex.toDouble / ColorPermutationSequenceLength.toDouble
      val (r, g, b) = colormapJet(colorValueDecimal)
      val rByte = Math.round(r * 255).toInt & 0xff
      val gByte = Math.round(g * 255).toInt & 0xff
      val bByte = Math.round(b * 255).toInt & 0xff
      val alphaByte = if (preserveAlpha) opacityAlphaByte else 0xff
      (alphaByte << 24) | (rByte << 16) | (gByte << 8) | (bByte << 0)
    }

  private def createBufferedImageFromBytes(
      b: Array[Byte],
      targetType: Int,
      params: ImageCreatorParameters
  ): Option[BufferedImage] =
    try {
      val bufferedImage = new BufferedImage(params.slideWidth, params.slideHeight, targetType)
      bufferedImage.setRGB(
        0,
        0,
        params.slideWidth,
        params.slideHeight,
        toRGBArray(
          b,
          params.elementClass,
          params.isSegmentation,
          params.intensityRange,
          params.color,
          params.invertColor.getOrElse(false),
          params.preserveAlpha,
          params.opacity
        ),
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
