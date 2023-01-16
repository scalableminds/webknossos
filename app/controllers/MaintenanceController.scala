package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.MultiUserDAO
import oxalis.security.WkEnv
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class MaintenanceController @Inject()(sil: Silhouette[WkEnv],
                                      maintenanceDAO: MaintenanceDAO,
                                      multiUserDAO: MultiUserDAO)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val maintenanceDuration: FiniteDuration = 10 minutes

  def info: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      expirationTime <- maintenanceDAO.getExpirationTime
      isMaintenance = !expirationTime.isPast
    } yield Ok(Json.obj("isMaintenance" -> Json.toJson(isMaintenance)))
  }

  def initMaintenance: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser)
      _ <- maintenanceDAO.updateExpirationTime(Instant.in(maintenanceDuration))
    } yield Ok("maintenance.init.success")
  }

  def closeMaintenance: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser)
      _ <- maintenanceDAO.updateExpirationTime(Instant.zero)
    } yield Ok("maintenance.close.success")
  }

}

class MaintenanceDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

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
