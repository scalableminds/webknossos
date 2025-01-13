package controllers

import com.scalableminds.util.objectid.ObjectId
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.dataset.DatasetDAO
import models.folder.{Folder, FolderDAO, FolderParameters, FolderService}
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.UserService
import play.api.libs.json.{JsArray, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import utils.MetadataAssertions

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject()(
    folderDAO: FolderDAO,
    folderService: FolderService,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    datasetDAO: DatasetDAO,
    organizationDAO: OrganizationDAO,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits
    with MetadataAssertions {

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
        _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
        - <- Fox.assertTrue(folderDAO.isEditable(idValidated)) ?~> "folder.update.notAllowed" ~> FORBIDDEN
        _ <- folderService.assertValidFolderName(params.name)
        _ <- assertNoDuplicateMetadataKeys(params.metadata)
        _ <- folderDAO.updateMetadata(idValidated, params.metadata)
        _ <- folderDAO.updateName(idValidated, params.name) ?~> "folder.update.name.failed"
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
      _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
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
      datasetsCount <- datasetDAO.countByFolder(idValidated)
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
      allEditableIdsSet = allEditableIds.toSet
      foldersWithParentsJson = foldersWithParents.map(f => folderService.publicWritesWithParent(f, allEditableIdsSet))
    } yield Ok(Json.toJson(foldersWithParentsJson))
  }

  def create(parentId: String, name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      parentIdValidated <- ObjectId.fromString(parentId)
      _ <- folderService.assertValidFolderName(name)
      newFolder = Folder(ObjectId.generate, name, JsArray.empty)
      _ <- folderDAO.findOne(parentIdValidated) ?~> "folder.notFound"
      _ <- folderDAO.insertAsChild(parentIdValidated, newFolder) ?~> "folder.create.failed"
      organization <- organizationDAO.findOne(request.identity._organization) ?~> "folder.notFound"
      folderJson <- folderService.publicWrites(newFolder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

}
