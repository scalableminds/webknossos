package braingames.image

import java.io.File
import java.util.Iterator
import javax.imageio._
import javax.imageio.stream._
import java.awt.image.BufferedImage

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
    val output = new FileImageOutputStream(file)
    writer.setOutput(output)
    val image = new IIOImage(buffered, null, null)
    writer.write(null, image, iwp)
    writer.reset()
    file
  }
}

class JPEGWriter extends ImageWriter("jpeg", ".jpg") {
  iwp.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
  iwp.setCompressionQuality(imageQuality)
}

class PNGWriter extends ImageWriter("png", ".png") 
