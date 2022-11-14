package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.DataSetDAO
import models.folder.{Folder, FolderDAO, FolderParameters, FolderService}
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.UserService
import oxalis.security.WkEnv
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject()(
    folderDAO: FolderDAO,
    folderService: FolderService,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    dataSetDAO: DataSetDAO,
    organizationDAO: OrganizationDAO,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def getRoot: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      rootFolder <- folderDAO.findOne(organization._rootFolder)
      rootFolderJson <- folderService.publicWrites(rootFolder, Some(request.identity), Some(organization))
    } yield Ok(rootFolderJson)
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      folder <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
      organization <- organizationDAO.findOne(request.identity._organization)
      folderJson <- folderService.publicWrites(folder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def update(id: String): Action[FolderParameters] = sil.SecuredAction.async(validateJson[FolderParameters]) {
    implicit request =>
      for {
        idValidated <- ObjectId.fromString(id)
        params = request.body
        organization <- organizationDAO.findOne(request.identity._organization)
        oldFolder <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
        _ <- Fox
          .runIf(oldFolder.name != params.name)(folderDAO.updateName(idValidated, params.name)) ?~> "folder.update.name.failed"
        _ <- folderService
          .updateAllowedTeams(idValidated, params.allowedTeams, request.identity) ?~> "folder.update.teams.failed"
        updated <- folderDAO.findOne(idValidated)
        folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
      } yield Ok(folderJson)
  }

  def move(id: String, newParentId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      newParentIdValidated <- ObjectId.fromString(newParentId)
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- bool2Fox(organization._rootFolder != idValidated) ?~> "folder.move.root"
      folderToMove <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
      _ <- folderDAO.findOne(newParentIdValidated) ?~> "folder.notFound"
      _ <- folderDAO.moveSubtree(idValidated, newParentIdValidated)
      updated <- folderDAO.findOne(idValidated)
      folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def delete(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- bool2Fox(organization._rootFolder != idValidated) ?~> "folder.delete.root"
      _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
      childrenCount <- folderDAO.countChildren(idValidated)
      datasetsCount <- dataSetDAO.countByFolder(idValidated)
      _ <- bool2Fox(childrenCount == 0) ?~> "folder.delete.notEmpty.children"
      _ <- bool2Fox(datasetsCount == 0) ?~> "folder.delete.notEmpty.datasets"
      _ <- folderDAO.deleteOne(idValidated)
    } yield Ok
  }

  def getTree: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      foldersWithParents <- folderDAO.findTreeOf(organization._rootFolder)
      allEditableIds <- folderDAO.findAllEditableIds
      foldersWithParentsJson = foldersWithParents.map(f =>
        folderService.publicWritesWithParent(f, allEditableIds.toSet))
    } yield Ok(Json.toJson(foldersWithParentsJson))
  }

  def create(parentId: String, name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      parentIdValidated <- ObjectId.fromString(parentId)
      newFolder = Folder(ObjectId.generate, name)
      _ <- folderDAO.insertAsChild(parentIdValidated, newFolder) ?~> "folder.create.failed"
      organization <- organizationDAO.findOne(request.identity._organization) ?~> "folder.notFound"
      folderJson <- folderService.publicWrites(newFolder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

}
