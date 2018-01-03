/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.image

import java.awt.image.{BufferedImage, DataBufferByte}
import java.io._
import javax.imageio._
import javax.imageio.stream._

class ImageWriter(imageType: String, imageExt: String) {
  val imageQuality = 1F
  val iter = ImageIO.getImageWritersByFormatName(imageType)
  val writer = iter.next()
  val iwp: ImageWriteParam = writer.getDefaultWriteParam()

  def writeToFile(buffered: BufferedImage): File = {
    val file = File.createTempFile("temp", System.nanoTime().toString + imageExt)
    writeToFile(buffered, file)
  }

  def writeToFile(buffered: BufferedImage, file: File) = {
    if (file.exists) file.delete
    var output: FileImageOutputStream = null
    try {
      output = new FileImageOutputStream(file)
      writer.setOutput(output)
      val image = new IIOImage(buffered, null, null)
      writer.write(null, image, iwp)
      writer.reset()
    } finally{
      if(output != null) output.close()
    }
    file
  }

  def writeToOutputStream(buffered: BufferedImage)(output: OutputStream) = {
    try {
      writer.setOutput(ImageIO.createImageOutputStream(output))
      val image = new IIOImage(buffered, null, null)
      writer.write(null, image, iwp)
      writer.reset()
    } finally{
      if(output != null) output.close()
    }
  }
}

class JPEGWriter extends ImageWriter("jpeg", ".jpg") {
  iwp.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
  iwp.setCompressionQuality(imageQuality)
}

class PNGWriter extends ImageWriter("png", ".png")

class WebPWriter {
  val imageExt = ".webp"
  val imageQuality = 0.7F

  System.loadLibrary("webpwrapper")

  @native def webPEncode(data: Array[Byte], width: Int, height: Int, qualityFactor: Double, imageType: Int): Array[Byte]

  def writeToFile(buffered: BufferedImage): File = {
    val file = File.createTempFile("temp", System.nanoTime().toString + imageExt)
    writeToFile(buffered, file)
  }

  def writeToFile(buffered: BufferedImage, file: File): File = {
    if (file.exists) file.delete
    var output: FileOutputStream = null
    try {
      output = new FileOutputStream(file)
      val data = buffered.getData.getDataBuffer.asInstanceOf[DataBufferByte].getData
      output.write(webPEncode(data, buffered.getWidth, buffered.getHeight, imageQuality * 100, buffered.getType))
    } finally {
      if(output != null) output.close()
    }
    file
  }
}
