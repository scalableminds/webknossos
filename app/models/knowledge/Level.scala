package models.knowledge

import models.basics._
import java.io.File
import com.mongodb.casbah.commons.MongoDBObject
import org.apache.commons.io.FileUtils
import play.api.Play
import org.bson.types.ObjectId

case class Level(
    name: String , 
    width: Int,
    height: Int,
    depth: Int,
    code: String = Level.defaultCode,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Level] {
  val dao = Level

  lazy val id = _id.toString
  
  def dataSetName = "2012-09-28_ex145_07x2"
  
  val assetsFolder =
    s"${Level.assetsBaseFolder}/$name/assets"

  private def assetFile(name: String) =
    new File(assetsFolder + "/" + name)

  def assets = {
    val f = new File(assetsFolder).listFiles()
    if(f == null)
      Array[File]()
    else
      f
  }
  
  def alterCode(c: String) = {
    copy(code = c)
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

  def fromForm(name: String, width: Int, height: Int, depth: Int) = {
    Level(name, width, height, depth)
  }
  
  val empty = Level("", 250, 150, 30)
  
  def toForm(level: Level) = {
    Some(level.name, level.width, level.height, level.depth)
  }
  
  val assetsBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelCreator.assetsDirecory").getOrElse("levels")
    (new File(folderName).mkdirs())
    folderName
  }

  val LevelNameRx = "[0-9A-Za-z\\_\\-\\s\\t]+"r
  val AssetsNameRx = "[0-9A-Za-z\\_\\-\\.\\s\\t]+"r

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

  val defaultCode = """
    |time(start : 0, end : 10) ->
    |  importSlides(start : 0, end : 10)
  """.stripMargin
}