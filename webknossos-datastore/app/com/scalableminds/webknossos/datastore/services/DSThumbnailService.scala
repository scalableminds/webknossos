package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.image.{Color, JPEGWriter}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.image.{ImageCreator, ImageCreatorParameters}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import scala.concurrent.ExecutionContext

class DSThumbnailService @Inject() {

  private val MaxThumbnailDimension = 5000

  def validateThumbnailDimensions(width: Int, height: Int)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.fromBool(
      width > 0 && width <= MaxThumbnailDimension && height > 0 && height <= MaxThumbnailDimension
    ) ?~> s"Thumbnail width and height must be between 1 and $MaxThumbnailDimension, got $width×$height."

  def renderLayerThumbnail(
      data: Array[Byte],
      elementClass: ElementClass.Value,
      width: Int,
      height: Int,
      intensityRange: Option[(Double, Double)],
      isSegmentation: Boolean,
      color: Option[Color],
      invertColor: Option[Boolean],
      outputWidth: Option[Int] = None,
      outputHeight: Option[Int] = None,
      preserveAlpha: Boolean = false,
      opacity: Double = 100
  )(implicit ec: ExecutionContext): Fox[BufferedImage] = for {
    imageCreatorParams = ImageCreatorParameters(
      elementClass,
      width = width,
      height = height,
      intensityRange = intensityRange,
      isSegmentation = isSegmentation,
      color = color,
      invertColor = invertColor,
      preserveAlpha = preserveAlpha,
      opacity = opacity
    )
    dataWithFallback =
      if (data.length == 0)
        new Array[Byte](width * height * ElementClass.bytesPerElement(elementClass))
      else data
    bufferedImage <- ImageCreator.imageFor(dataWithFallback, imageCreatorParams).toFox ?~> Msg.Image.createFailed
  } yield resizeIfNeeded(bufferedImage, outputWidth.getOrElse(width), outputHeight.getOrElse(height))

  private def resizeIfNeeded(image: BufferedImage, outputWidth: Int, outputHeight: Int): BufferedImage =
    if (image.getWidth == outputWidth && image.getHeight == outputHeight) image
    else {
      val scaled = new BufferedImage(outputWidth, outputHeight, BufferedImage.TYPE_INT_ARGB)
      val graphics = scaled.createGraphics()
      graphics.drawImage(image, 0, 0, outputWidth, outputHeight, null)
      graphics.dispose()
      scaled
    }

  def bufferedImageToJpeg(bufferedImage: BufferedImage): Box[Array[Byte]] =
    tryo {
      val outputStream = new ByteArrayOutputStream()
      new JPEGWriter().writeToOutputStream(bufferedImage)(outputStream)
      outputStream.toByteArray
    }

  def blendLayersToJpeg(
      colorImages: Seq[BufferedImage],
      segmentationImages: Seq[BufferedImage],
      blendMode: String,
      width: Int,
      height: Int
  ): Array[Byte] = {
    // Color layers are combined per the dataset's configured blend mode.
    // Segmentation layers are then alpha-blended on top
    val composite = blendColorLayers(colorImages, blendMode, width, height)
    val graphics = composite.createGraphics()
    segmentationImages.foreach(image => graphics.drawImage(image, 0, 0, null))
    graphics.dispose()
    val outputStream = new ByteArrayOutputStream()
    new JPEGWriter().writeToOutputStream(composite)(outputStream)
    outputStream.toByteArray
  }

  private def blendColorLayers(
      colorImages: Seq[BufferedImage],
      blendMode: String,
      width: Int,
      height: Int
  ): BufferedImage =
    blendMode match {
      case "Cover" => blendColorLayersCover(colorImages, width, height, blackAsTransparent = false)
      case "CoverWithBlackAsTransparent" =>
        blendColorLayersCover(colorImages, width, height, blackAsTransparent = true)
      case _ => blendColorLayersAdditively(colorImages, width, height)
    }

  private def blendColorLayersAdditively(colorImages: Seq[BufferedImage], width: Int, height: Int): BufferedImage = {
    val accum = new Array[Int](width * height)
    colorImages.foreach { image =>
      val pixels = image.getRGB(0, 0, width, height, null, 0, width)
      var i = 0
      while (i < pixels.length) {
        val argb = pixels(i)
        val alpha = (argb >>> 24) & 0xff
        val r = (argb >>> 16) & 0xff
        val g = (argb >>> 8) & 0xff
        val b = argb & 0xff
        val existing = accum(i)
        val newR = Math.min(255, ((existing >>> 16) & 0xff) + (r * alpha) / 255)
        val newG = Math.min(255, ((existing >>> 8) & 0xff) + (g * alpha) / 255)
        val newB = Math.min(255, (existing & 0xff) + (b * alpha) / 255)
        accum(i) = (0xff << 24) | (newR << 16) | (newG << 8) | newB
        i += 1
      }
    }
    val blended = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    blended.setRGB(0, 0, width, height, accum, 0, width)
    blended
  }

  private def blendColorLayersCover(
      colorImages: Seq[BufferedImage],
      width: Int,
      height: Int,
      blackAsTransparent: Boolean
  ): BufferedImage = {
    val destR = new Array[Double](width * height)
    val destG = new Array[Double](width * height)
    val destB = new Array[Double](width * height)
    val destA = new Array[Double](width * height)
    colorImages.foreach { image =>
      val pixels = image.getRGB(0, 0, width, height, null, 0, width)
      var i = 0
      while (i < pixels.length) {
        val argb = pixels(i)
        val r = (argb >>> 16) & 0xff
        val g = (argb >>> 8) & 0xff
        val b = argb & 0xff
        val srcA =
          if (blackAsTransparent && r == 0 && g == 0 && b == 0) 0.0
          else ((argb >>> 24) & 0xff) / 255.0
        val dA = destA(i)
        val mixedAlphaFactor = (1.0 - dA) * srcA
        val mixedAlpha = mixedAlphaFactor + dA
        if (mixedAlpha > 0.0) {
          destR(i) = (dA * destR(i) + mixedAlphaFactor * r) / mixedAlpha
          destG(i) = (dA * destG(i) + mixedAlphaFactor * g) / mixedAlpha
          destB(i) = (dA * destB(i) + mixedAlphaFactor * b) / mixedAlpha
        }
        destA(i) = mixedAlpha
        i += 1
      }
    }
    val pixels = new Array[Int](width * height)
    var i = 0
    while (i < pixels.length) {
      pixels(i) = (0xff << 24) | (Math.round(destR(i)).toInt << 16) | (Math.round(destG(i)).toInt << 8) | Math
        .round(destB(i))
        .toInt
      i += 1
    }
    val blended = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    blended.setRGB(0, 0, width, height, pixels, 0, width)
    blended
  }

}
