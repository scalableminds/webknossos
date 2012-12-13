package braingames.image

import java.io.File
import javax.imageio._
import javax.imageio.stream._
import java.awt.image.BufferedImage

class ImageWriter {
  val imageQuality = 0.8F
  val iter = ImageIO.getImageWritersByFormatName("jpeg")
  val writer = iter.next()
  val iwp: ImageWriteParam = writer.getDefaultWriteParam()

  iwp.setCompressionMode(ImageWriteParam.MODE_EXPLICIT)
  iwp.setCompressionQuality(imageQuality)

  def asJPGToFile(buffered: BufferedImage, fileName: String) {
    val file = new File(fileName)
    if(file.exists) file.delete
    val output = new FileImageOutputStream(file)
    writer.setOutput(output)
    val image = new IIOImage(buffered, null, null)
    writer.write(null, image, iwp)
    writer.reset()
  }
}