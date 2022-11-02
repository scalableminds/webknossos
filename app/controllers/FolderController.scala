package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.binary.DataSetDAO
import models.folder.{Folder, FolderDAO, FolderParameters, FolderService}
import models.organization.OrganizationDAO
import models.team.TeamDAO
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
        organization <- organizationDAO.findOne(request.identity._organization)
        _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
        _ <- folderDAO.updateName(idValidated, request.body.name)
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
      updated <- folderDAO.findOne(idValidated)
      folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def updateTeams(id: String): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        idValidated <- ObjectId.fromString(id)
        _ <- folderDAO.findOne(idValidated) ?~> "folder.notFound"
        includeMemberOnlyTeams = request.identity.isDatasetManager
        userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
        oldAllowedTeams: List[ObjectId] <- folderDAO.allowedTeamIdsFor(idValidated)
        teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
        teamsWithUpdate = request.body.filter(t => userTeams.exists(_._id == t))
        newTeamIds = (teamsWithUpdate ++ teamsWithoutUpdate).distinct
        _ <- folderDAO.updateAllowedTeamsFor(idValidated, newTeamIds)
      } yield Ok(Json.toJson(newTeamIds))
    }

  def getTree: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      foldersWithParents <- folderDAO.findTreeOf(organization._rootFolder)
      foldersWithParentsJson = foldersWithParents.map(folderService.publicWritesWithParent)
    } yield Ok(Json.toJson(foldersWithParentsJson))
  }

  def create(parentId: String, name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      parentFolderIdValidated <- ObjectId.fromString(parentId)
      newFolder = Folder(ObjectId.generate, name)
      _ <- folderDAO.insertAsChild(parentFolderIdValidated, newFolder)
      organization <- organizationDAO.findOne(request.identity._organization)
      folderJson <- folderService.publicWrites(newFolder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

}
