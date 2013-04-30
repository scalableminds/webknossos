package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId
import com.mongodb.casbah.commons.MongoDBObject
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.novus.salat._
import models.context._
import scala.util.Random

case class ContextFreeMission(missionId: Int, start: MissionStart, errorCenter: Point3D, possibleEnds: List[PossibleEnd], difficulty: Double) {
  def addContext(dataSetName: String, batchId: Int) = Mission(dataSetName, missionId, batchId, start, errorCenter, possibleEnds, difficulty: Double)
}

object ContextFreeMission extends Function5[Int, MissionStart, Point3D, List[PossibleEnd], Double, ContextFreeMission] {
  implicit val ContextFreeMissionReader: Reads[ContextFreeMission] = Json.reads[ContextFreeMission]
}

case class Mission(dataSetName: String,
                   missionId: Int,
                   batchId: Int,
                   start: MissionStart,
                   errorCenter: Point3D,
                   possibleEnds: List[PossibleEnd],
                   difficulty: Double,
                   _id: ObjectId = new ObjectId) extends DAOCaseClass[Mission] {

  val key: String = dataSetName.toString + "_" + missionId.toString

  val dao = Mission
  lazy val id = _id.toString

  def withDataSetName(newDataSetName: String) = copy(dataSetName = newDataSetName)

  def batchId(newBatchId: Int) = copy(batchId = newBatchId)
}

object Mission extends BasicDAO[Mission]("missions") with CommonFormats with Function8[String, Int, Int, MissionStart, Point3D, List[PossibleEnd], Double, ObjectId, Mission] {

  def findByDataSetName(dataSetName: String) = find(MongoDBObject("dataSetName" -> dataSetName)).toList

  def findOneByMissionId(missionId: Int) = findOne(MongoDBObject("missionId" -> missionId))

  def randomByDataSetName(dataSetName: String) = {
    val missions = findByDataSetName(dataSetName)
    if (!missions.isEmpty)
      Some(missions(Random.nextInt(missions.size)))
    else None
  }

  def updateOrCreate(m: Mission) =
    findOne(MongoDBObject(
      "dataSetName" -> m.dataSetName,
      "missionId" -> m.missionId)) match {
      case Some(stored) =>
        stored.update(_ => m.copy(_id = stored._id))
        stored._id
      case _ =>
        insertOne(m)
        m._id
    }

  def deleteAllForDataSetExcept(dataSetName: String, missions: List[Mission]) = {
    val obsoleteMissions =
      findByDataSetName(dataSetName)
        .filterNot(m =>
          missions.exists(_.missionId == m.missionId))

    removeByIds(obsoleteMissions.map(_._id))
    obsoleteMissions.map(_.id)
  }

  implicit val missionFormat: Format[Mission] = Json.format[Mission]
}