package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.folder.{Folder, FolderDAO, FolderParameters, FolderService}
import models.organization.OrganizationDAO
import oxalis.security.WkEnv
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject()(
    folderDAO: FolderDAO,
    folderService: FolderService,
    organizationDAO: OrganizationDAO,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def getRoot: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      rootFolder <- folderDAO.findOne(organization._rootFolder)
      rootFolderJson <- folderService.publicWrites(rootFolder)
    } yield Ok(rootFolderJson)
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      folder <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
      folderJson <- folderService.publicWrites(folder)
    } yield Ok(folderJson)
  }

  def update(id: String): Action[FolderParameters] = sil.SecuredAction.async(validateJson[FolderParameters]) {
    implicit request =>
      for {
        idValidated <- ObjectId.fromString(id)
        _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
        _ <- folderDAO.updateName(idValidated, request.body.name)
        updated <- folderDAO.findOne(idValidated)
        folderJson <- folderService.publicWrites(updated)
      } yield Ok(folderJson)
  }

  def getTree: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      foldersWithParents <- folderDAO.findTreeOf(organization._rootFolder)
    } yield Ok(Json.toJson(foldersWithParents))
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
