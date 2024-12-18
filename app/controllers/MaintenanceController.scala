package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.UserService
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import com.scalableminds.webknossos.schema.Tables._
import security.WkEnv

class MaintenanceController @Inject()(
    sil: Silhouette[WkEnv],
    maintenanceDAO: MaintenanceDAO,
    maintenanceService: MaintenanceService,
    userService: UserService)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val adHocMaintenanceDuration: FiniteDuration = 5 minutes

  def listCurrentAndUpcoming: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      currentAndUpcomingMaintenances <- maintenanceDAO.findCurrentAndUpcoming
      js = currentAndUpcomingMaintenances.map(maintenanceService.publicWrites)
    } yield Ok(Json.toJson(js))
  }

  def readOne(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      maintenance <- maintenanceDAO.findOne(id)
    } yield Ok(maintenanceService.publicWrites(maintenance))
  }

  def update(id: ObjectId): Action[MaintenanceParameters] =
    sil.SecuredAction.async(validateJson[MaintenanceParameters]) { implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        _ <- maintenanceDAO.findOne(id) ?~> "maintenance.notFound"
        _ <- maintenanceDAO.updateOne(id, request.body)
        updated <- maintenanceDAO.findOne(id)
      } yield Ok(maintenanceService.publicWrites(updated))
    }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      _ <- maintenanceDAO.deleteOne(id)
    } yield Ok
  }

  def listAll: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      maintenances <- maintenanceDAO.findAll
      js = maintenances.map(maintenanceService.publicWrites)
    } yield Ok(Json.toJson(js))
  }

  def create: Action[MaintenanceParameters] = sil.SecuredAction.async(validateJson[MaintenanceParameters]) {
    implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
        newMaintenance = Maintenance(ObjectId.generate,
                                     request.identity._id,
                                     request.body.startTime,
                                     request.body.endTime,
                                     request.body.message)
        _ <- maintenanceDAO.insertOne(newMaintenance)
      } yield Ok(maintenanceService.publicWrites(newMaintenance))
  }

  def createAdHocMaintenance: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- userService.assertIsSuperUser(request.identity) ?~> "notAllowed" ~> FORBIDDEN
      newMaintenance = Maintenance(ObjectId.generate,
                                   request.identity._id,
                                   Instant.now,
                                   Instant.in(adHocMaintenanceDuration),
                                   "WEBKNOSSOS is temporarily under maintenance.")
      _ <- maintenanceDAO.insertOne(newMaintenance)
    } yield Ok(maintenanceService.publicWrites(newMaintenance))
  }

}

case class Maintenance(_id: ObjectId,
                       _user: ObjectId,
                       startTime: Instant,
                       endTime: Instant,
                       message: String,
                       created: Instant = Instant.now,
                       isDeleted: Boolean = false)

case class MaintenanceParameters(startTime: Instant, endTime: Instant, message: String)

object MaintenanceParameters {
  implicit val jsonFormat: OFormat[MaintenanceParameters] = Json.format[MaintenanceParameters]
}

class MaintenanceService @Inject()() {
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
      rows <- run(q"SELECT $columns FROM $existingCollectionName WHERE endTime >= ${Instant.now}".as[MaintenancesRow])
      parsed <- parseAll(rows)
    } yield parsed

  def findAll: Fox[List[Maintenance]] =
    for {
      rows <- run(q"SELECT $columns FROM $existingCollectionName".as[MaintenancesRow])
      parsed <- parseAll(rows)
    } yield parsed

  def insertOne(m: Maintenance): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.maintenances (_id, _user, startTime, endTime, message, created, isDeleted)
            VALUES(${m._id}, ${m._user}, ${m.startTime}, ${m.endTime}, ${m.message}, ${m.created}, ${m.isDeleted})
         """.asUpdate)
    } yield ()

  def updateOne(id: ObjectId, params: MaintenanceParameters): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.maintenances SET
          startTime = ${params.startTime},
          endTime = ${params.endTime},
          message = ${params.message}
          WHERE _id = $id
         """.asUpdate)
    } yield ()

}
