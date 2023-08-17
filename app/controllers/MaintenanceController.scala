package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.MultiUserDAO
import oxalis.security.WkEnv
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent}
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import com.scalableminds.webknossos.schema.Tables._
import slick.jdbc.PostgresProfile.api._

class MaintenanceController @Inject()(sil: Silhouette[WkEnv],
                                      maintenanceDAO: MaintenanceDAO,
                                      maintenenaceService: MaintenanceService,
                                      multiUserDAO: MultiUserDAO)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val adHocMaintenanceDuration: FiniteDuration = 5 minutes

  def readOne(id: String): Action[AnyContent] = ???
  def update(id: String): Action[AnyContent] = ???
  def delete(id: String): Action[AnyContent] = ???

  def listCurrentAndUpcoming: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      currentAndUpcomingMaintenances <- maintenanceDAO.findCurrentAndUpcoming
      js = currentAndUpcomingMaintenances.map(maintenenaceService.publicWrites)
    } yield Ok(Json.toJson(js))
  }

  def listAll: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      currentAndUpcomingMaintenances <- maintenanceDAO.findAll
      js = currentAndUpcomingMaintenances.map(maintenenaceService.publicWrites)
    } yield Ok(Json.toJson(js))
  }

  def create: Action[AnyContent] = ???

  def createAdHocMaintenance: Action[AnyContent] = ???

}

case class Maintenance(_id: ObjectId,
                       _user: ObjectId,
                       startTime: Instant,
                       endTime: Instant,
                       message: String,
                       created: Instant = Instant.now,
                       isDeleted: Boolean = false)

class MaintenanceService @Inject()(maintenanceDAO: MaintenanceDAO) {
  def publicWrites(m: Maintenance): JsObject =
    Json.obj(
      "id" -> m._id,
      "startTime" -> m.startTime,
      "endTime" -> m.endTime,
      "message" -> m.message
    )
}

class MaintenanceDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Maintenance, MaintenancesRow, Maintenances](sqlClient) {
  protected val collection = Maintenances

  protected def idColumn(x: Maintenances): Rep[String] = x._Id

  protected def isDeletedColumn(x: Maintenances): Rep[Boolean] = x.isdeleted

  protected def parse(r: MaintenancesRow): Fox[Maintenance] =
    Fox.successful(
      Maintenance(ObjectId(r._Id),
                  ObjectId(r._User),
                  Instant.fromSql(r.starttime),
                  Instant.fromSql(r.endtime),
                  r.message,
                  Instant.fromSql(r.created),
                  r.isdeleted)
    )

  def findCurrentAndUpcoming: Fox[List[Maintenance]] =
    for {
      rows <- run(q"""SELECT $columns
            FROM $existingCollectionName
            WHERE startTime """.as[MaintenancesRow])
      parsed <- parseAll(rows)
    } yield parsed

  def findAll: Fox[List[Maintenance]] = ???

  def getExpirationTime: Fox[Instant] =
    for {
      timeList <- run(q"select maintenanceExpirationTime from webknossos.maintenance".as[Instant])
      time <- timeList.headOption.toFox
    } yield time

  def updateExpirationTime(newExpirationTime: Instant): Fox[Unit] =
    for {
      _ <- run(q"update webknossos.maintenance set maintenanceExpirationTime = $newExpirationTime".asUpdate)
    } yield ()
}
