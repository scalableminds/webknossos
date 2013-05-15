package braingames.stackrenderer

import braingames.image.ImagePartInfo
import braingames.util.FileIO
import java.io.File

object XmlAtlas {

  def infoToXml(infos: List[ImagePartInfo], fileName: String) = {
    s"""<?xml version="1.0" encoding="UTF-8"?>
        |<TextureAtlas imagePath="$fileName">
        |  ${
              infos.zipWithIndex.map {
                case (i, idx) =>
                  s"""<SubTexture name="$idx" x="${i.x}" y="${i.y}" width="${i.width}" height="${i.height}"/>"""
              }.mkString("\n")
            }
        |</TextureAtlas>""".stripMargin
  }

  def writeToFile(infos: List[ImagePartInfo], fileName: String, file: File) = {
    FileIO.printToFile(file) { p =>
      p.print(infoToXml(infos, fileName))
    }
  }
}