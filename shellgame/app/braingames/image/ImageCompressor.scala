package braingames.image

import java.io.File
import java.awt.image.BufferedImage
import javax.imageio.ImageIO
import scala.Array.canBuildFrom

class ImageCompressor {
  def compress(images: Array[File]) = {
    if (images.isEmpty) {
      println("ImageCompressor called with no images!!!")
      None
    } else {
      val bufferedImages = images.map(ImageIO.read).filterNot( _ == null)
      val width = bufferedImages(0).getWidth()
      val height = bufferedImages(0).getHeight()
      val imageType = bufferedImages(0).getType()
      val depth = bufferedImages.size
      
      val finalImage = new BufferedImage(width, height * depth, BufferedImage.TYPE_INT_RGB)

      bufferedImages.zipWithIndex.foreach {
        case (image, idx) =>
          assert( image.getWidth() == width, "Wong image size!")
          finalImage.createGraphics().drawImage(image, 0, height * idx, null)
      }
      Some(finalImage)
    }
  }
}