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
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents, PlayBodyParsers}
import security.WkEnv
import utils.MetadataAssertions

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject() (
    folderDAO: FolderDAO,
    folderService: FolderService,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    datasetDAO: DatasetDAO,
    organizationDAO: OrganizationDAO,
    sil: Silhouette[WkEnv],
    cc: ControllerComponents
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits
    with MetadataAssertions {

  def getRoot: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      rootFolder <- folderDAO.findOne(organization._rootFolder)
      rootFolderJson <- folderService.publicWrites(rootFolder, Some(request.identity), Some(organization))
    } yield Ok(rootFolderJson)
  }

  def get(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      folder <- folderDAO.findOne(id) ?~> "folder.notFound"
      organization <- organizationDAO.findOne(request.identity._organization)
      folderJson <- folderService.publicWrites(folder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def update(id: ObjectId): Action[FolderParameters] = sil.SecuredAction.async(validateJson[FolderParameters]) {
    implicit request =>
      for {
        _ <- Fox.successful(())
        params = request.body
        organization <- organizationDAO.findOne(request.identity._organization)
        _ <- folderDAO.findOne(id) ?~> "folder.notFound"
        - <- Fox.assertTrue(folderDAO.isEditable(id)) ?~> "folder.update.notAllowed" ~> FORBIDDEN
        _ <- folderService.assertValidFolderName(params.name)
        _ <- assertNoDuplicateMetadataKeys(params.metadata)
        _ <- folderDAO.updateMetadata(id, params.metadata)
        _ <- folderDAO.updateName(id, params.name) ?~> "folder.update.name.failed"
        _ <- folderService.updateAllowedTeams(
          id,
          params.allowedTeams,
          request.identity
        ) ?~> "folder.update.teams.failed"
        updated <- folderDAO.findOne(id)
        folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
      } yield Ok(folderJson)
  }

  def move(id: ObjectId, newParentId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- bool2Fox(organization._rootFolder != id) ?~> "folder.move.root"
      _ <- folderDAO.findOne(id) ?~> "folder.notFound"
      _ <- folderDAO.findOne(newParentId) ?~> "folder.notFound"
      _ <- folderDAO.moveSubtree(id, newParentId)
      updated <- folderDAO.findOne(id)
      folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- bool2Fox(organization._rootFolder != id) ?~> "folder.delete.root"
      _ <- folderDAO.findOne(id) ?~> "folder.notFound"
      childrenCount <- folderDAO.countChildren(id)
      datasetsCount <- datasetDAO.countByFolder(id)
      _ <- bool2Fox(childrenCount == 0) ?~> "folder.delete.notEmpty.children"
      _ <- bool2Fox(datasetsCount == 0) ?~> "folder.delete.notEmpty.datasets"
      _ <- folderDAO.deleteOne(id)
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

  def create(parentId: ObjectId, name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- folderService.assertValidFolderName(name)
      newFolder = Folder(ObjectId.generate, name, JsArray.empty)
      _ <- folderDAO.findOne(parentId) ?~> "folder.notFound"
      _ <- folderDAO.insertAsChild(parentId, newFolder) ?~> "folder.create.failed"
      organization <- organizationDAO.findOne(request.identity._organization) ?~> "folder.notFound"
      folderJson <- folderService.publicWrites(newFolder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

}
