package models.knowledge

import models.basics._
import java.io.File
import com.mongodb.casbah.commons.MongoDBObject
import org.apache.commons.io.FileUtils
import play.api.Play

case class Level(name: String) extends DAOCaseClass[Level] {
  val dao = Level

  val assetsFolder =
    Level.assetsBaseFolder + "/" + name + "/assets"

  private def assetFile(name: String) =
    new File(assetsFolder + "/" + name)

  def assets = {
    new File(assetsFolder).listFiles()
  }
  
  def retrieveAsset(name: String) = {
    val f = assetFile(name)
    if (f.getPath.startsWith(assetsFolder) && f.exists)
      Some(f)
    else
      None
  }

  def deleteAsset(name: String) = {
    val f = assetFile(name)
    if (f.getPath.startsWith(assetsFolder) && f.exists)
      f.delete()
    else
      false
  }

  def addAsset(fileName: String, file: File) = {
    if (Level.isValidAssetName(fileName)) {
      FileUtils.copyFile(file, assetFile(fileName))
      true
    } else
      false
  }
}

object Level extends BasicKnowledgeDAO[Level]("levels") {

  val assetsBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelCreator.assetsDirecory").getOrElse("levels")
    (new File(folderName).mkdirs())
    folderName
  }

  val LevelNameRx = "[0-9A-Za-z\\_\\-]+"r
  val AssetsNameRx = "[0-9A-Za-z\\_\\-\\.]+"r

  def create(name: String) =
    if (isValidLevelName(name))
      insert(Level(name))

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def isValidAssetName(name: String) = {
    name match {
      case AssetsNameRx() if !name.contains("..") =>
        true
      case _ =>
        false
    }
  }

  def isValidLevelName(name: String) = {
    name match {
      case LevelNameRx() =>
        true
      case _ =>
        false
    }
  }
}