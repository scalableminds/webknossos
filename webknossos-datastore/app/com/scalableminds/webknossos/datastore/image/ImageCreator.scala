package com.scalableminds.webknossos.datastore.image

import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.image.Color
import com.typesafe.scalalogging.LazyLogging

import java.awt.image.BufferedImage
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

case class ImageCreatorParameters(
    elementClass: ElementClass.Value,
    width: Int = 128,
    height: Int = 128,
    intensityRange: Option[(Double, Double)] = None,
    isSegmentation: Boolean = false,
    color: Option[Color] = None,
    invertColor: Option[Boolean] = None,
    // When true, render into an alpha-capable image: segmentation id 0 becomes fully transparent
    // and every other pixel's alpha is derived from `opacity`, instead of always being fully opaque.
    // Used when compositing multiple layers on top of each other.
    preserveAlpha: Boolean = false,
    opacity: Double = 100
)

object ImageCreator extends LazyLogging {

  def imageFor(data: Array[Byte], params: ImageCreatorParameters): Box[BufferedImage] = tryo {
    val bufferedImageType = if (params.preserveAlpha) BufferedImage.TYPE_INT_ARGB else BufferedImage.TYPE_3BYTE_BGR
    val bufferedImage = new BufferedImage(params.width, params.height, bufferedImageType)
    val rgbArray = toRGBArray(
      data,
      params.elementClass,
      params.isSegmentation,
      params.intensityRange,
      params.color,
      params.invertColor.getOrElse(false),
      params.preserveAlpha,
      params.opacity
    )
    bufferedImage.setRGB(0, 0, params.width, params.height, rgbArray, 0, params.width)
    bufferedImage
  }

  private def toRGBArray(
      data: Array[Byte],
      elementClass: ElementClass.Value,
      isSegmentation: Boolean,
      intensityRangeOpt: Option[(Double, Double)],
      color: Option[Color],
      invertColor: Boolean,
      preserveAlpha: Boolean,
      opacity: Double
  ): Array[Int] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val rgbOutputArray = new Array[Int](data.length / bytesPerElement)
    var idx = 0
    val intensityRange = intensityRangeOpt.getOrElse(ElementClass.defaultIntensityRange(elementClass))
    val opacityAlphaByte =
      Math.round(com.scalableminds.util.tools.MathUtils.clamp(opacity, 0d, 100d) / 100.0 * 255).toInt & 0xff
    while (idx + bytesPerElement <= data.length) {
      rgbOutputArray(idx / bytesPerElement) =
        if (isSegmentation)
          idToRGB(readSegmentId(data, idx, bytesPerElement), preserveAlpha, opacityAlphaByte)
        else {
          val colorRedCallable = applyColor(color.map(_.r).getOrElse(1d), invertColor)
          val colorGreenCallable = applyColor(color.map(_.g).getOrElse(1d), invertColor)
          val colorBlueCallable = applyColor(color.map(_.b).getOrElse(1d), invertColor)
          val grayNormalized = normalizeIntensityGray(data, idx, intensityRange, elementClass)
          elementClass match {
            case ElementClass.uint24 => // assume uint24 rgb color data
              (opacityAlphaByte << 24) | ((data(idx) & 0xff) << 16) | ((data(idx + 1) & 0xff) << 8) | ((data(
                idx + 2
              ) & 0xff) << 0)
            case _ =>
              (opacityAlphaByte << 24) | (colorRedCallable(grayNormalized) << 16) | (colorGreenCallable(
                grayNormalized
              ) << 8) | (
                colorBlueCallable(grayNormalized) << 0
              )
          }
        }
      idx += bytesPerElement
    }
    rgbOutputArray
  }

  private def normalizeIntensityGray(
      data: Array[Byte],
      idx: Int,
      intensityRange: (Double, Double),
      elementClass: ElementClass.Value
  ): Int = elementClass match {
    case ElementClass.uint8 =>
      normalizeIntensityUint8(intensityRange, data(idx))
    case ElementClass.int8 =>
      normalizeIntensityInt8(intensityRange, data(idx))
    case ElementClass.uint16 =>
      normalizeIntensityUint16(intensityRange, data(idx), data(idx + 1))
    case ElementClass.int16 =>
      normalizeIntensityInt16(intensityRange, data(idx), data(idx + 1))
    case ElementClass.uint32 =>
      normalizeIntensityUint32(intensityRange, data(idx), data(idx + 1), data(idx + 2), data(idx + 3))
    case ElementClass.int32 =>
      normalizeIntensityInt32(intensityRange, data(idx), data(idx + 1), data(idx + 2), data(idx + 3))
    case ElementClass.uint64 =>
      normalizeIntensityUint64(
        intensityRange,
        data(idx),
        data(idx + 1),
        data(idx + 2),
        data(idx + 3),
        data(idx + 4),
        data(idx + 5),
        data(idx + 6),
        data(idx + 7)
      )
    case ElementClass.int64 =>
      normalizeIntensityInt64(
        intensityRange,
        data(idx),
        data(idx + 1),
        data(idx + 2),
        data(idx + 3),
        data(idx + 4),
        data(idx + 5),
        data(idx + 6),
        data(idx + 7)
      )
    case ElementClass.float =>
      normalizeIntensityFloat(intensityRange, data(idx), data(idx + 1), data(idx + 2), data(idx + 3))
    case ElementClass.uint24 => // assume uint24 rgb color data
      data(idx).toInt // The color data is handled separately
    case _ =>
      throw new Exception(s"Unsupported ElementClass for color layer thumbnail: $elementClass")
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

  private def idToRGB(id: Long, preserveAlpha: Boolean, opacityAlphaByte: Int): Int =
    if (id == 0L) {
      // background: transparent for full-dataset thumbnails, solid-gray for standalone layer thumbnail.
      if (preserveAlpha) 0
      else (0x64 << 24) | (0x64 << 16) | (0x64 << 8) | (0x64 << 0)
    } else {
      val significantSegmentIndex = ((id & 0xffffL) + ((id >>> 32) & 0xffffL)).toInt
      val colorIndex =
        getElementOfPermutation(significantSegmentIndex, colorPermutationSequenceLength, colorPermutationPrimitiveRoot)
      val colorValueDecimal = colorIndex.toDouble / colorPermutationSequenceLength.toDouble
      val (r, g, b) = colormapJet(colorValueDecimal)
      val rByte = Math.round(r * 255).toInt & 0xff
      val gByte = Math.round(g * 255).toInt & 0xff
      val bByte = Math.round(b * 255).toInt & 0xff
      val alphaByte = if (preserveAlpha) opacityAlphaByte else 0xff
      (alphaByte << 24) | (rByte << 16) | (gByte << 8) | (bByte << 0)
    }

  private val colorPermutationSequenceLength = 19
  private val colorPermutationPrimitiveRoot = 2

  // Rounds to float32 precision, mirroring the frontend's `imprecise` helper
  // (frontend/javascripts/viewer/shaders/utils.glsl.ts), which keeps this JS/Scala port consistent
  // with the GLSL shader's own (32-bit float) arithmetic.
  private def imprecise(x: Double): Double = x.toFloat.toDouble

  private def glslPow(x: Double, y: Double): Double = {
    val log2x = imprecise(Math.log(x) / Math.log(2))
    imprecise(Math.pow(2, y * log2x))
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

  private def getElementOfPermutation(index: Int, sequenceLength: Int, primitiveRoot: Int): Int = {
    val oneBasedIndex = (index % sequenceLength) + 1
    if (oneBasedIndex == 1) sequenceLength
    else (Math.floor(glslPow(primitiveRoot, oneBasedIndex)).toLong % sequenceLength).toInt
  }

}
