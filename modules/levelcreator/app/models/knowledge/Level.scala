package models.knowledge

import models.basics._
import java.io.{ File, PrintWriter }
import com.mongodb.casbah.commons.MongoDBObject
import org.apache.commons.io.FileUtils
import play.api.Play
import org.bson.types.ObjectId
import play.api.libs.json._
import play.api.libs.functional.syntax._
import play.api.data.validation.ValidationError
import controllers.levelcreator.StackController

case class LevelId(name: String, version: Int = 0){
  override def toString = s"${name}__${version}"
}

case class Asset(accessName: String, version: Int){
  def fileName = s"${version}__$accessName"
  
  def assetFile(assetsFolder: String) = 
    new File(assetsFolder + "/" + fileName)
  
  def file(assetsFolder: String): Option[File] = { 
    val f = assetFile(assetsFolder)
    if (f.getPath.startsWith(assetsFolder) && f.exists)
      Some(f)
    else
      None
  } 
  
  def deleteFromDisk(assetsFolder: String) = {
    val f = assetFile(assetsFolder)
    if (f.getPath.startsWith(assetsFolder) && f.exists)
      f.delete()
  }
  
  def writeToDisk(assetsFolder: String, file: File) = {
    FileUtils.copyFile(file, assetFile(assetsFolder))
  }
}

object Asset extends Function2[String, Int, Asset]{
  val AssetsNameRx = "[0-9A-Za-z\\_\\-\\.\\s\\t]+"r
  
  implicit val assetFormat = Json.format[Asset]
  
  def isValidAssetName(name: String) = {
    name match {
      case AssetsNameRx() if !name.contains("..") =>
        true
      case _ =>
        false
    }
  }
}

case class Level(
    levelId: LevelId /*ID, must be unique*/,
    width: Int,
    height: Int,
    slidesBeforeProblem: Int,
    slidesAfterProblem: Int,
    dataSetName: String,
    parent: LevelId,
    isLatest: Boolean = true,
    isActive: Boolean = true,
    code: String = Level.defaultCode,
    autoRender: Boolean = false,
    assets: List[Asset] = Nil,
    timestamp: Long = System.currentTimeMillis,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Level] {
  val dao = Level

  lazy val id = _id.toString

  lazy val depth = slidesBeforeProblem + slidesAfterProblem

  val assetsFolder =
    s"${Level.assetsBaseFolder}/${levelId.name}/assets"

  val stackFolder =
    s"${Level.stackBaseFolder}/${levelId.name}/${levelId.version}/stacks"

  def assetFiles = assets.flatMap(a => retrieveAsset(a))
    
  def numberOfRenderedStacks = 
    RenderedStack.countFor(levelId)

  def alterCode(c: String) = {
    copy(code = c)
  }

  def retrieveAsset(asset: Asset): Option[File] = { 
    asset.file(assetsFolder)
  }  
  
  def assetFromName(name: String) = 
    assets.find(_.accessName == name)
  
  def retrieveAsset(name: String): Option[File] = assetFromName(name).flatMap{ a =>
    retrieveAsset(a)
  }

  def deleteAsset(name: String): Level = {
    assetFromName(name).map{ a =>
      if(a.version == levelId.version)
        a.deleteFromDisk(assetsFolder)
      copy(assets = assets.filterNot(_.accessName == name))
    } getOrElse this
  }

  def addAsset(fileName: String, file: File): Level = {
    if (Asset.isValidAssetName(fileName)) {
      val asset = Asset(fileName, levelId.version)
      asset.writeToDisk(assetsFolder, file)
      copy(assets = asset :: assets.filterNot(_.accessName == fileName))
    } else
      this
  }
}

trait CommonFormats {
  implicit object objectIdFormat extends Format[ObjectId] {
    def reads(json: JsValue) = json match {
      case JsString(s) => {
        if (ObjectId.isValid(s))
          JsSuccess(new ObjectId(s))
        else
          JsError(ValidationError("validate.error.objectid"))
      }
      case _ => JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.jsstring"))))
    }

    def writes(o: ObjectId) = JsString(o.toString)
  }
}

object Level extends BasicDAO[Level]("levels") with CommonFormats with Function14[LevelId, Int, Int, Int, Int, String, LevelId, Boolean, Boolean, String, Boolean, List[Asset], Long, ObjectId, Level] {
  this.collection.ensureIndex("levelId")
  
  import Asset.assetFormat
  
  implicit val levelIdFormat = Json.format[LevelId]
  
  implicit val levelFormat = Json.format[Level]

  val defaultDataSetName = "2012-09-28_ex145_07x2"

  def fromForm(name: String, width: Int, height: Int, slidesBeforeProblem: Int, slidesAfterProblem: Int, dataSetName: String) = {
    Level(LevelId(name), width, height, slidesBeforeProblem, slidesAfterProblem, dataSetName, LevelId(name))
  }

  val empty = Level(LevelId(""), 250, 150, 15, 15, defaultDataSetName, LevelId(""))

  def toForm(level: Level) = {
    Some(level.levelId.name, level.width, level.height, level.slidesBeforeProblem, level.slidesAfterProblem, level.dataSetName)
  }

  val stackBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelcreator.stackDirectory").getOrElse("data/levels")
    (new File(folderName).mkdirs())
    folderName
  }

  val assetsBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelcreator.assetsDirecory").getOrElse("data/levels")
    (new File(folderName).mkdirs())
    folderName
  }
  
  def createNewVersion(level: Level, code: String) = {
    if(code != level.code){
      val updated = 
        level.copy(
            _id = new ObjectId, 
            levelId = level.levelId.copy(version = 
              NextLevelVersion.getNextVersion(level.levelId.name)), 
            isActive = false,
            parent = level.levelId,
            timestamp = System.currentTimeMillis(),
            code = code)
      insert(updated)
      level.update(_.copy(isLatest = false))
      updated
    } else {
      level
    }
  }

  def findAllLatest() =
    find(MongoDBObject("isLatest" -> true)).toList
  
  def findAllActive() =
    find(MongoDBObject("isLatest" -> true)).toList
  
  def findAutoRenderLevels() = 
    find(MongoDBObject("autoRender" -> true, "isActive" -> true)).toList
    
  def ensureMissions(level: Level, missions: List[ObjectId]) = {
    val rendered = 
      RenderedStack.findFor(level.levelId).map(_.mission._id) :::
      StacksQueued.findFor(level.levelId).map(_.mission._id) :::
      StacksInProgress.findFor(level.levelId).map(_._mission)
      
    val notRendered = missions.filterNot(m => rendered.contains(m))
    StackController.create(level, notRendered.flatMap( e => Mission.findOneById(e)))
  }

  def findByName(name: String) =
    find(MongoDBObject("levelId.name" -> name)).toList

  def findOneById(levelId: LevelId) =
    findOne(MongoDBObject("levelId" -> levelId))  
    
  def findActiveOneBy(name: String) =
    findOne(MongoDBObject("levelId.name" -> name, "isActive" -> true))
        
  def findActiveByDataSetName(dataSetName: String) =
    find(MongoDBObject("dataSetName" -> dataSetName, "isActive" -> true)).toList
    
  def findActiveAutoRenderByDataSetName(dataSetName: String) = 
    find(MongoDBObject("dataSetName" -> dataSetName, "isActive" -> true, "autoRender" -> true)).toList

  
  val LevelNameRx = "[0-9A-Za-z\\_\\-\\s\\t]+"r
  
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