package braingames.stackrenderer

import braingames.image.ImagePartInfo
import braingames.util.FileIO
import java.io.File
import braingames.image.CombinedImage
import braingames.image.CombinedPage

object XmlAtlas {

  def infoToXml(image: CombinedImage) = {
    s"""<?xml version="1.0" encoding="UTF-8"?>
        |${ image.pages.map(pageToXml) }""".stripMargin
  }
        
  def pageToXml(page: CombinedPage) = {
    s"""<TextureAtlas imagePath="${page.pageInfo.name}">
          |  ${
                page.info.zipWithIndex.map {
                  case (i, idx) =>
                    s"""<SubTexture name="$idx" x="${i.x}" y="${i.y}" width="${i.width}" height="${i.height}"/>"""
                }.mkString("\n")
              }
          |</TextureAtlas>
        |}""".stripMargin
  }

  def writeToFile(image: CombinedImage, file: File) = {
    FileIO.printToFile(file) { p =>
      p.print(infoToXml(image))
    }
  }
}