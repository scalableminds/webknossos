package models.knowledge

import braingames.geometry.Point3D
import play.api.libs.json._
import play.api.libs.functional.syntax._
import models.knowledge.basics.BasicReactiveDAO
import scala.concurrent.Future
import reactivemongo.api.indexes.{IndexType, Index}
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import play.modules.reactivemongo.json.BSONFormats.BSONObjectIDFormat
import play.api.Logger

case class ContextFreeMission(missionId: Int, start: StartSegment, errorCenter: Point3D, end: SimpleSegment, possibleEnds: List[EndSegment], difficulty: Double) {
  def addContext(dataSetName: String, batchId: Int) = Mission(dataSetName, missionId, batchId, start, errorCenter, end, possibleEnds, difficulty)
}

object ContextFreeMission {
  //} extends Function5[Int, StartSegment, Point3D, List[EndSegment], Double, ContextFreeMission] {
  implicit val ContextFreeMissionReader: Reads[ContextFreeMission] = Json.reads[ContextFreeMission]
}

case class Mission(dataSetName: String,
  missionId: Int,
  batchId: Int,
  start: StartSegment,
  errorCenter: Point3D,
  end: SimpleSegment,
  possibleEnds: List[EndSegment],
  difficulty: Double,
  missionStatus: MissionStatus = MissionStatus.initial,
  random: Double = Math.random(),
  isFinished: Boolean = false,
  _id: BSONObjectID = BSONObjectID.generate) {

  val id = _id.stringify

  val key: String = dataSetName + "__" + batchId + "__" + missionId

  def stringify = s"Mission(mid = $missionId, bid = $batchId, ds = $dataSetName)"
}


trait MissionFormats {
  implicit val formatter: OFormat[Mission] = Json.format[Mission]
}

object MissionDAO extends BasicReactiveDAO[Mission] with MissionFormats {

  val collectionName = "missions"

  collection.indexesManager.ensure(Index(Seq("random" -> IndexType.Ascending)))
  collection.indexesManager.ensure(Index(Seq("renderStatus.numberOfRenderedStacks" -> IndexType.Ascending)))


  def findByDataSetNameQ(dataSetName: String) =
    Json.obj("dataSetName" -> dataSetName)

  def findByDataSetName(dataSetName: String)(implicit ctx: DBAccessContext) =
    collectionFind(findByDataSetNameQ(dataSetName)).cursor[Mission].enumerate()

  def findNotRenderedFor(levelId: String)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "missionStatus.renderStatus.renderedFor" -> Json.obj("$ne" -> levelId),
      "missionStatus.renderStatus.abortedFor" -> Json.obj("$ne" -> levelId)
    )).cursor[Mission].enumerate()

  def findOneByMissionId(missionId: Int)(implicit ctx: DBAccessContext) =
    findOne(Json.obj("missionId" -> missionId))

  def findRandomOne(q: JsObject)(implicit ctx: DBAccessContext): Future[Option[Mission]] = {
    val rand = Math.random()
    collectionFind(q ++ Json.obj("random" -> Json.obj("$gte" -> rand))).one[Mission].flatMap {
      case Some(r) => Future.successful(Some(r))
      case _ => collectionFind(q ++ Json.obj("random" -> Json.obj("$lte" -> rand))).one[Mission]
    }
  }

  def successfullyRendered(level: Level, mission: Mission)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("_id" -> mission._id),
      Json.obj("$push" -> Json.obj("missionStatus.renderStatus.renderedFor" -> level.levelId)))
  }

  def failedToRender(level: Level, mission: Mission, reason: String)(implicit ctx: DBAccessContext) = {
    val aborted = AbortedRendering(level.levelId, reason)
    collectionUpdate(
      Json.obj("_id" -> mission._id),
      Json.obj("$addToSet" -> Json.obj("missionStatus.renderStatus.abortedFor" -> aborted)))
  }

  def randomByDataSetName(dataSetName: String)(implicit ctx: DBAccessContext) = {
    findRandomOne(findByDataSetNameQ(dataSetName))
  }

  def updateOrCreate(m: Mission)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj(
      "dataSetName" -> m.dataSetName,
      "batchId" -> m.batchId,
      "missionId" -> m.missionId)).one[Mission].map {
      case Some(m) => Future.successful(m)
      case _ => insert(m).map(_ => m)
    }
  }


  def findLeastRenderedUnFinished()(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("isFinished" -> false))
      .sort(Json.obj("renderStatus.numberOfRenderedStacks" -> 1))
      .cursor[Mission].enumerate()
  }

  // TODO: This is horribly inefficient, we definitly need another way to delete missions
  /*def deleteAllForBatchExcept(dataSetName: String, missions: List[Mission]) = {
    val obsoleteMissions =
      findByDataSetName(dataSetName)
        .filterNot(m =>
          missions.exists(_.missionId == m.missionId))

    removeByIds(obsoleteMissions.map(_._id))
    obsoleteMissions.map(_.id)
  } */

}