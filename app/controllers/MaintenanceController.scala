package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.user.MultiUserDAO
import oxalis.security.WkEnv
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import slick.jdbc.PostgresProfile.api._
import utils.sql.{SQLClient, SimpleSQLDAO}
import scala.concurrent.duration._

import scala.concurrent.ExecutionContext

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

class MaintenanceDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def getExpirationTime: Fox[Instant] =
    for {
      timeList <- run(sql"select maintenanceExpirationTime from webknossos.maintenance".as[Instant])
      time <- timeList.headOption.toFox
    } yield time

  def updateExpirationTime(newExpirationTime: Instant): Fox[Unit] =
    for {
      _ <- run(sqlu"update webknossos.maintenance set maintenanceExpirationTime = $newExpirationTime")
    } yield ()
}
