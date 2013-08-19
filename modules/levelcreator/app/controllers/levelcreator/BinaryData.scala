package controllers.levelcreator

import scala.concurrent.duration._
import play.api.mvc._
import akka.util.Timeout
import play.api.i18n.Messages
import braingames.geometry._
import _root_.models.knowledge._
import scala.concurrent.Future
import braingames.levelcreator.BinaryDataService
import braingames.reactivemongo.{UnAuthedDBAccess, GlobalDBAccess}
import braingames.mvc.ExtendedController
import play.api.Play
import braingames.binary.models.DataLayerId
import scala.Some
import braingames.binary.DataRequest
import braingames.binary.Cuboid
import braingames.binary.DataRequestSettings
import braingames.binary.models.DataSet
import play.api.libs.concurrent.Execution.Implicits._

object BinaryData extends ExtendedController with Controller with UnAuthedDBAccess with BinaryDataRequestHandler {
  val conf = Play.current.configuration

  implicit val timeout = Timeout((conf.getInt("actor.defaultTimeout") getOrElse 20) seconds) // needed for `?` below

  val binaryDataService = BinaryDataService

  def viaAjax(dataSetName: String, levelId: String, missionId: String, dataLayerName: String) =
    Action {
      implicit request =>
        Async {
          for {
            dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataset.notFound")
            level <- LevelDAO.findOneById(levelId) ?~> Messages("level.notFound")
            mission <- MissionDAO.findOneById(missionId) ?~> Messages("mission.notFound")
            result <- handleDataRequest(dataSet, dataLayerName, level, mission) ?~> "Data couldn't be retrieved"
          } yield {
            Ok(result)
          }
        }
    }
}

trait BinaryDataRequestHandler {
  val binaryDataService: braingames.binary.api.BinaryDataService

  private def createRequest(dataSet: DataSet, dataLayerId: DataLayerId, cuboid: Cuboid) = {

    val settings = DataRequestSettings(
      useHalfByte = false,
      skipInterpolation = false
    )

    DataRequest(
      dataSet,
      dataLayerId,
      1,
      cuboid,
      settings)
  }

  private def createStackCuboid(level: Level, mission: Mission) = {

    def calculateTopLeft(width: Int, height: Int, depth: Int) = {
      Vector3D(-(width / 2.0).floor, -(height / 2.0).floor, -level.slidesBeforeProblem)
    }

    val direction = Vector3D(mission.start.direction.x * 11.24, mission.start.direction.y * 11.24, mission.start.direction.z * 28).normalize

    Cuboid(level.width,
      level.height,
      level.depth,
      1,
      topLeftOpt = Some(calculateTopLeft(level.width, level.height, level.depth)),
      moveVector = Vector3D(mission.errorCenter).toTuple,
      axis = direction.toTuple)
  }

  def handleDataRequest(dataSet: DataSet, dataLayerName: String, level: Level, mission: Mission): Future[Option[Array[Byte]]] = {
    val dataRequest = createRequest(
      dataSet,
      DataLayerId(dataLayerName),
      createStackCuboid(level, mission))

    binaryDataService.handleDataRequest(dataRequest)
  }
}
