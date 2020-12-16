package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.user.MultiUserDAO
import oxalis.security.WkEnv
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}
import slick.jdbc.PostgresProfile.api._
import utils.{SQLClient, SimpleSQLDAO}

import scala.concurrent.ExecutionContext

class MaintenanceController @Inject()(sil: Silhouette[WkEnv],
                                      maintenanceDAO: MaintenanceDAO,
                                      multiUserDAO: MultiUserDAO)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def info: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      expirationTime <- maintenanceDAO.getExpirationTime
      isMaintenance = expirationTime.getTime >= System.currentTimeMillis
    } yield Ok(Json.obj("isMaintenance" -> Json.toJson(isMaintenance)))
  }

  def initMaintenance: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser)
      _ <- maintenanceDAO.updateExpirationTime(new java.sql.Timestamp(System.currentTimeMillis + 1000 * 60 * 10))
    } yield Ok("maintenance.init.success")
  }

  def closeMaintenance: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser)
      _ <- maintenanceDAO.updateExpirationTime(new java.sql.Timestamp(0))
    } yield Ok("maintenance.close.success")
  }

}

class MaintenanceDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def getExpirationTime: Fox[java.sql.Timestamp] =
    for {
      timeList <- run(sql"select maintenanceExpirationTime from webknossos.maintenance".as[java.sql.Timestamp])
      time <- timeList.headOption.toFox
    } yield time

  def updateExpirationTime(newTimestamp: java.sql.Timestamp): Fox[Unit] =
    for {
      _ <- run(sql"update webknossos.maintenance set maintenanceExpirationTime = $newTimestamp".as[java.sql.Timestamp])
    } yield ()
}
