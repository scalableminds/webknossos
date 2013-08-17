package models.knowledge

import java.io.{File, PrintWriter}
import org.apache.commons.io.FileUtils
import play.api.Play
import play.api.libs.json._
import play.api.libs.functional.syntax._
import play.api.data.validation.ValidationError
import controllers.levelcreator.StackController
import models.knowledge.basics.BasicReactiveDAO
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import net.liftweb.common.{Empty, Failure, Full}
import play.api.i18n.Messages
import braingames.util.{FoxImplicits, Fox}

case class LevelId(name: String, version: Int = 0) {
  override def toString = s"${name}__${version}"

  def toBeautifiedString = name + ", Version " + version
}

object LevelId {
  implicit val levelIdFormat = Json.format[LevelId]
}

case class Asset(accessName: String, version: Int) {
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

object Asset {
  val AssetsNameRx = "[0-9A-Za-z\\_\\-\\.\\s\\t]+" r

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
  levelId: LevelId /*ID, must be unique*/ ,
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
  _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  lazy val depth = slidesBeforeProblem + slidesAfterProblem

  val assetsFolder =
    s"${Level.assetsBaseFolder}/${levelId.name}/assets"

  val stackFolder =
    s"${Level.stackBaseFolder}/${levelId.name}/${levelId.version}/stacks"

  def assetFiles = assets.flatMap(a => retrieveAsset(a))

  def alterCode(c: String) = {
    copy(code = c)
  }

  def retrieveAsset(asset: Asset): Option[File] = {
    asset.file(assetsFolder)
  }

  def assetFromName(name: String) =
    assets.find(_.accessName == name)

  def retrieveAsset(name: String): Option[File] = assetFromName(name).flatMap {
    a =>
      retrieveAsset(a)
  }
}

trait LevelFormats {
  implicit val levelIdFormat = Json.format[LevelId]

  implicit val formatter = Json.format[Level]
}

object Level {
  val defaultDataSetName = "2012-09-28_ex145_07x2"

  val LevelNameRx = "[0-9A-Za-z\\_\\-\\s\\t]+" r

  val defaultCode = """
                      |time(start : 0, end : 10) ->
                      |  importSlides(start : 0, end : 10)
                    """.stripMargin

  val empty = Level(LevelId(""), 250, 150, 15, 15, defaultDataSetName, LevelId(""))

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

  def fromForm(name: String, width: Int, height: Int, slidesBeforeProblem: Int, slidesAfterProblem: Int, dataSetName: String) = {
    Level(LevelId(name), width, height, slidesBeforeProblem, slidesAfterProblem, dataSetName, LevelId(name))
  }

  def toForm(level: Level) = {
    Some(level.levelId.name, level.width, level.height, level.slidesBeforeProblem, level.slidesAfterProblem, level.dataSetName)
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

object LevelDAO extends BasicReactiveDAO[Level] with LevelFormats with FoxImplicits {

  import Asset.assetFormat

  val collectionName = "levels"

  def createNewVersion(level: Level, code: String)(implicit ctx: DBAccessContext): Fox[Level] = {
    if (code != level.code) {
      NextLevelVersion.getNextVersion(level.levelId.name).flatMap {
        nextVersion =>
          val updated =
            level.copy(
              _id = BSONObjectID.generate,
              levelId = level.levelId.copy(version = nextVersion),
              isActive = false,
              parent = level.levelId,
              timestamp = System.currentTimeMillis(),
              code = code)
          insert(updated).flatMap {
            r =>
              if (r.ok)
                updateLatestStatus(level, isLatest = false).map(_ => Full(updated))
              else
                Future.successful(Failure("Couldn't insert updated version"))
          }
      }
    } else {
      Future.successful(Failure("There was no code change."))
    }
  }

  def updateLatestStatus(level: Level, isLatest: Boolean)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("_id" -> level._id),
      Json.obj("$set" -> Json.obj(
        "isLatest" -> isLatest)))
  }

  def updateAutorenderStatus(level: Level, shouldAutorender: Boolean)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("_id" -> level._id),
      Json.obj("$set" -> Json.obj(
        "autoRender" -> shouldAutorender)))
  }

  def addAssetToLevel(level: Level, name: String, file: File)(implicit ctx: DBAccessContext) = {
    if (Asset.isValidAssetName(name)) {
      val asset = Asset(name, level.levelId.version)
      asset.writeToDisk(level.assetsFolder, file)
      val assets = asset :: level.assets.filterNot(_.accessName == name)
      collectionUpdate(Json.obj("_id" -> level._id),
        Json.obj("$set" -> Json.obj("assets" -> assets))).map {
        r =>
          if (!r.ok)
            Empty
          else
            Full(r)
      }
    } else
      Future.successful(Failure("Invalid asset name"))
  }

  def removeAssetFromLevel(level: Level, assetName: String)(implicit ctx: DBAccessContext) = {
    (level.assetFromName(assetName) ?~> Messages("level.assets.notFound")).flatMap {
      a =>
        if (a.version == level.levelId.version)
          a.deleteFromDisk(level.assetsFolder)
        val assets = level.assets.filterNot(_.accessName == assetName)
        collectionUpdate(Json.obj("_id" -> level._id),
          Json.obj("$set" -> Json.obj("assets" -> assets))).map {
          r =>
            if (!r.ok)
              Empty
            else
              Full(r)
        }
    }
  }

  def setAsActiveVersion(level: Level)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj(
        "levelId.name" -> level.levelId.name),
      Json.obj(
        "$set" -> Json.obj("isActive" -> false)))

    collectionUpdate(
      Json.obj(
        "levelId.name" -> level.levelId.name,
        "levelId.version" -> level.levelId.version),
      Json.obj(
        "$set" -> Json.obj("isActive" -> true)))
  }

  def findAllLatest()(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "isLatest" -> true)).cursor[Level].toList

  def findAllActive()(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "isActive" -> true)).cursor[Level].toList

  def findAutoRenderLevels()(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "autoRender" -> true,
      "isActive" -> true)).cursor[Level].toList

  def findByNameQ(name: String) =
    Json.obj("levelId.name" -> name)

  def findByName(name: String)(implicit ctx: DBAccessContext) =
    collectionFind(findByNameQ(name)).cursor[Level].toList

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    collectionFind(findByNameQ(name)).one[Level]

  def findOneById(levelId: LevelId)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "levelId.name" -> levelId.name,
      "levelId.version" -> levelId.version)).one[Level]

  def findActiveOneBy(name: String)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "levelId.name" -> name,
      "isActive" -> true)).one[Level]

  def findActiveByDataSetName(dataSetName: String)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "dataSetName" -> dataSetName,
      "isActive" -> true)).cursor[Level].toList

  def findActiveAutoRender()(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "isActive" -> true,
      "autoRender" -> true)).cursor[Level].toList
}