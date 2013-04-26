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

case class Level(
    name: String,
    width: Int,
    height: Int,
    slidesBeforeProblem: Int,
    slidesAfterProblem: Int,
    dataSetName: String,
    code: String = Level.defaultCode,
    autoRender: Boolean = false,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Level] {
  val dao = Level

  lazy val id = _id.toString

  lazy val depth = slidesBeforeProblem + slidesAfterProblem

  val assetsFolder =
    s"${Level.assetsBaseFolder}/$name/assets"

  val stackFolder =
    s"${Level.stackBaseFolder}/$name"

  private def assetFile(name: String) = 
    new File(assetsFolder + "/" + name)

  def assets = {
    val f = new File(assetsFolder).listFiles()
    if (f == null)
      Array[File]()
    else
      f
  }
    
  def numberOfRenderedStacks = 
    RenderedStack.countFor(_id)

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

object Level extends BasicDAO[Level]("levels") with CommonFormats with Function9[String, Int, Int, Int, Int, String, String, Boolean, ObjectId, Level] {

  implicit val levelFormat = Json.format[Level]

  val defaultDataSetName = "2012-09-28_ex145_07x2"

  def fromForm(name: String, width: Int, height: Int, slidesBeforeProblem: Int, slidesAfterProblem: Int, dataSetName: String) = {
    Level(name, width, height, slidesBeforeProblem, slidesAfterProblem, dataSetName)
  }

  val empty = Level("", 250, 150, 15, 15, defaultDataSetName)

  def toForm(level: Level) = {
    Some(level.name, level.width, level.height, level.slidesBeforeProblem, level.slidesAfterProblem, level.dataSetName)
  }

  val stackBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelcreator.stackDirectory").getOrElse("public/levelStacks")
    (new File(folderName).mkdirs())
    folderName
  }

  val assetsBaseFolder = {
    val folderName =
      Play.current.configuration.getString("levelcreator.assetsDirecory").getOrElse("data")
    (new File(folderName).mkdirs())
    folderName
  }

  val LevelNameRx = "[0-9A-Za-z\\_\\-\\s\\t]+"r
  val AssetsNameRx = "[0-9A-Za-z\\_\\-\\.\\s\\t]+"r
  
  def findAutoRenderLevels() = 
    find(MongoDBObject("autoRender" -> true)).toList
    
  def ensureMissions(level: Level, missions: List[Mission]) = {
    val rendered = RenderedStack.findFor(level._id).map(_.mission.id)
    val notRendered = missions.filterNot(m => rendered.contains(m.id))
    StackController.create(level, notRendered)
  }

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def findByDataSetName(dataSetName: String) =
    find(MongoDBObject("dataSetName" -> dataSetName)).toList

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