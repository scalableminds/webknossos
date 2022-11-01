package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.folder.{Folder, FolderDAO, FolderService}
import models.organization.OrganizationDAO
import oxalis.security.WkEnv
import play.api.mvc.{Action, AnyContent}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject()(folderDAO: FolderDAO,
                                 folderService: FolderService,
                                 organizationDAO: OrganizationDAO,
                                 sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def getRoot: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      rootFolder <- folderDAO.findOne(organization._rootFolder)
      rootFolderJson <- folderService.publicWrites(rootFolder)
    } yield Ok(rootFolderJson)
  }

  def create(parentId: String, name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      parentFolderIdValidated <- ObjectId.fromString(parentId)
      newFolder = Folder(ObjectId.generate, name)
      _ <- folderDAO.insertAsChild(parentFolderIdValidated, newFolder)
      folderJson <- folderService.publicWrites(newFolder)
    } yield Ok(folderJson)
  }

}
