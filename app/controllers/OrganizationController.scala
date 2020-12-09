package controllers

import com.mohiva.play.silhouette.api.Silhouette
import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.team._
import oxalis.security.WkEnv
import play.api.libs.json.{JsNull, Json}
import play.api.mvc.{Action, AnyContent}
import utils.WkConf

import scala.concurrent.ExecutionContext

class OrganizationController @Inject()(organizationDAO: OrganizationDAO,
                                       organizationService: OrganizationService,
                                       conf: WkConf,
                                       sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def organizationsIsEmpty: Action[AnyContent] = Action.async { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(GlobalAccessContext) ?~> "organization.list.failed"
    } yield {
      Ok(Json.toJson(allOrgs.isEmpty))
    }
  }

  def get(organizationName: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      org <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext)
      js <- organizationService.publicWrites(org)(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organizations <- organizationDAO.findAll ?~> "organization.list.failed"
      js <- Fox.serialCombined(organizations)(o => organizationService.publicWrites(o))
    } yield Ok(Json.toJson(js))
  }

  def getDefault: Action[AnyContent] = Action.async { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(GlobalAccessContext) ?~> "organization.list.failed"
      org <- allOrgs.headOption.toFox ?~> "organization.list.failed"
      js <- organizationService.publicWrites(org)(GlobalAccessContext)
    } yield {
      if (allOrgs.length > 1) // Cannot list organizations publicly if there are multiple ones, due to privacy reasons
        Ok(JsNull)
      else
        Ok(Json.toJson(js))
    }
  }

  def getOperatorData: Action[AnyContent] = Action { implicit request =>
    Ok(Json.toJson(conf.operatorData))
  }
}
