package controllers

import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.team._
import play.api.libs.json.Json
import utils.WkConf

import scala.concurrent.ExecutionContext

class OrganizationController @Inject()(organizationDAO: OrganizationDAO,
                                       organizationService: OrganizationService,
                                       conf: WkConf)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def listAllOrganizations = Action.async { implicit request =>
    for {
      allOrgs <- organizationDAO.findAll(GlobalAccessContext) ?~> "organization.list.failed"
      _ <- bool2Fox(allOrgs.length <= 1) ?~> "organization.list.moreThanOne"
      js <- Fox.serialCombined(allOrgs)(o => organizationService.publicWrites(o)(GlobalAccessContext))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def get(organizationName: String) = Action.async { implicit request =>
    for {
      org <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext)
      js <- organizationService.publicWrites(org)(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def getOperatorData = Action { implicit request =>
    Ok(Json.toJson(conf.operatorData))
  }
}
