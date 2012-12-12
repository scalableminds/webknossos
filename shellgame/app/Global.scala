import akka.actor.Props
import play.api._
import play.api.Play.current
import play.api.libs.concurrent._
import braingames.image.ImageCompressor
import java.io.File
import java.awt.image.BufferedImage
import braingames.image.FileMapper
import braingames.image.ImageWriter

object Global extends GlobalSettings {
  val fileMappingPath = "filemap.json"
  val compressedFilePathTemplate = "compressed%d.jpg"

  override def onStart(app: Application) {
    val shellgameAssetsPath =
      app.configuration.getString("shellgame.shellgameAssetsPath").get

    println("Compressing images...")
    //val fileMapping = compressAllImages(new File(shellgameAssetsPath))
    println("Dir: " + new File(shellgameAssetsPath).getAbsolutePath)
    //FileMapper.writeToFile(fileMapping, shellgameAssetsPath + fileMappingPath)
    println("Done compressing.")
  }

  override def onStop(app: Application) {
  }

  def compressAllImages(dir: File): Map[String, Array[String]] = {
    implicit val rootDir = dir

    def compress(dir: File): Map[String, Array[String]] = {
      if (dir.isDirectory()) {
        dir.listFiles.groupBy(_.isDirectory).map {
          case (false, images) =>
            images
              .filter(i => i.getName().endsWith(".jpg") && !i.getName().contains("compressed"))
              .sortBy(_.getName)
              .sliding(13, 13)
              .toList
              .zipWithIndex
              .map(processImageStack(dir.getAbsolutePath))
          case (true, directories) =>
            directories
              .par
              .map(compress)
              .toList
        }.flatten.foldLeft(Map[String, Array[String]]())((m, e) => m ++ e)
      } else
        Map[String, Array[String]]()
    }
    compress(dir)
  }

  def processImageStack(parentDir: String)(is: Tuple2[Array[File], Int])(implicit rootDir: File) = {
    (new ImageCompressor).compress(is._1).map { compressed =>
      val path = writeCompressedImageToFile(parentDir)(compressed, is._2)
      Map(anonymifyFileName(path) -> is._1.map(f => anonymifyFileName(f.getAbsolutePath)))
    } getOrElse (Map[String, Array[String]]())
  }

  def writeCompressedImageToFile(parentDir: String)(compressed: BufferedImage, idx: Int) = {
    val path = parentDir + "/" + compressedFilePathTemplate.format(idx)
    println("saving to " + path)
    (new ImageWriter).asJPGToFile(compressed, path)
    path
  }

  def anonymifyFileName(fileName: String)(implicit rootDir: File) =
    fileName.replace(rootDir.getAbsolutePath, "")
}
