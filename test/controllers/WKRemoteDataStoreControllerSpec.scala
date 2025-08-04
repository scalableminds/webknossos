package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, Full}
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{LayerMagLinkInfo, MagLinkInfo}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayer, DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.{DataSourcePathInfo, DataSourceRegistrationInfo, DataStoreStatus}
import com.scalableminds.webknossos.datastore.services.uploading.{
  LinkedLayerIdentifier,
  ReserveAdditionalInformation,
  ReserveUploadInformation
}
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, UploadDatasetEvent}
import models.annotation.AnnotationDAO
import models.dataset._
import models.dataset.credential.CredentialDAO
import models.folder.FolderDAO
import models.job.{Job, JobDAO}
import models.organization.{Organization, OrganizationDAO}
import models.storage.UsedStorageService
import models.team.TeamDAO
import models.user.{MultiUser, MultiUserDAO, User, UserDAO, UserService}
import org.mockito.ArgumentMatchers._
import org.mockito.Mockito._
import org.mockito.invocation.InvocationOnMock
import org.scalatestplus.mockito.MockitoSugar
import org.scalatestplus.play._
import org.scalatestplus.play.guice._
import play.api.libs.json.Json
import play.api.mvc.{PlayBodyParsers, Result}
import play.api.test.Helpers._
import play.api.test._
import security.WebknossosBearerTokenAuthenticatorService
import telemetry.SlackNotificationService
import utils.WkConf

import scala.concurrent.ExecutionContext

class WKRemoteDataStoreControllerSpec extends PlaySpec with GuiceOneAppPerTest with MockitoSugar {

  implicit val ec: ExecutionContext = ExecutionContext.global
  
  // Mock dependencies
  val datasetService: DatasetService = mock[DatasetService]
  val dataStoreService: DataStoreService = mock[DataStoreService]
  val dataStoreDAO: DataStoreDAO = mock[DataStoreDAO]
  val analyticsService: AnalyticsService = mock[AnalyticsService]
  val userService: UserService = mock[UserService]
  val organizationDAO: OrganizationDAO = mock[OrganizationDAO]
  val usedStorageService: UsedStorageService = mock[UsedStorageService]
  val datasetDAO: DatasetDAO = mock[DatasetDAO]
  val datasetLayerDAO: DatasetLayerDAO = mock[DatasetLayerDAO]
  val userDAO: UserDAO = mock[UserDAO]
  val folderDAO: FolderDAO = mock[FolderDAO]
  val teamDAO: TeamDAO = mock[TeamDAO]
  val jobDAO: JobDAO = mock[JobDAO]
  val multiUserDAO: MultiUserDAO = mock[MultiUserDAO]
  val credentialDAO: CredentialDAO = mock[CredentialDAO]
  val annotationDAO: AnnotationDAO = mock[AnnotationDAO]
  val mailchimpClient: MailchimpClient = mock[MailchimpClient]
  val slackNotificationService: SlackNotificationService = mock[SlackNotificationService]
  val conf: WkConf = mock[WkConf]
  val bearerTokenService: WebknossosBearerTokenAuthenticatorService = mock[WebknossosBearerTokenAuthenticatorService]
  val bodyParsers: PlayBodyParsers = mock[PlayBodyParsers]

  // Mock data
  val organizationId = "org123"
  val userId = ObjectId.dummyId
  val datasetId = ObjectId.dummyId
  val jobId = ObjectId.dummyId

  val organization: Organization = mock[Organization]
  when(organization._id).thenReturn(ObjectId.fromString(organizationId).get)
  when(organization.name).thenReturn("Test Organization")
  when(organization._rootFolder).thenReturn(ObjectId.dummyId)
  when(organization.includedStorageBytes).thenReturn(Some(10000L))

  val user: User = mock[User]
  when(user._id).thenReturn(userId)
  when(user._organization).thenReturn(ObjectId.fromString(organizationId).get)
  when(user.isDatasetManager).thenReturn(true)

  val multiUser: MultiUser = mock[MultiUser]
  when(multiUser.isSuperUser).thenReturn(false)
  when(user._multiUser).thenReturn(ObjectId.dummyId)

  val dataset: Dataset = mock[Dataset]
  when(dataset._id).thenReturn(datasetId)
  when(dataset.name).thenReturn("test-dataset")
  when(dataset.directoryName).thenReturn("test-dir")
  when(dataset._organization).thenReturn(ObjectId.fromString(organizationId).get)
  when(dataset.folderId).thenReturn(ObjectId.dummyId)
  when(dataset.created).thenReturn(Instant.now)
  when(dataset.isPublic).thenReturn(true)
  when(dataset.isVirtual).thenReturn(true)
  when(dataset.dataSourceId).thenReturn(DataSourceId("test", organizationId))

  val dataStore: DataStore = mock[DataStore]
  when(dataStore.name).thenReturn("test-datastore")
  when(dataStore.onlyAllowedOrganization).thenReturn(None)

  val dataSource: DataSource = mock[DataSource]
  when(dataSource.allExplicitPaths).thenReturn(List("/existing/path"))
  when(dataSource.toUsable).thenReturn(Some(dataSource))
  when(dataSource.dataLayers).thenReturn(List.empty)

  val job: Job = mock[Job]
  when(job._id).thenReturn(jobId)
  when(job._owner).thenReturn(userId)
  when(job.latestRunId).thenReturn(Some("run123"))
  when(job.exportFileName).thenReturn(Some("export.zip"))

  val controller = new WKRemoteDataStoreController(
    datasetService,
    dataStoreService,
    dataStoreDAO,
    analyticsService,
    userService,
    organizationDAO,
    usedStorageService,
    datasetDAO,
    datasetLayerDAO,
    userDAO,
    folderDAO,
    teamDAO,
    jobDAO,
    multiUserDAO,
    credentialDAO,
    annotationDAO,
    mailchimpClient,
    slackNotificationService,
    conf,
    mock[security.WkSilhouetteEnvironment]
  )(ec, bodyParsers)

  "WKRemoteDataStoreController" should {

    "handle reserveDatasetUpload successfully" in {
      val uploadInfo = ReserveUploadInformation(
        name = "test-dataset",
        organization = organizationId,
        totalFileSizeInBytes = Some(1000L),
        folderId = Some(ObjectId.dummyId.toString),
        initialTeams = None,
        layersToLink = None,
        requireUniqueName = Some(false)
      )

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type])).thenReturn(Fox.successful(organization))
      when(organizationDAO.getUsedStorage(any[ObjectId])).thenReturn(Fox.successful(500L))
      when(datasetService.assertValidDatasetName(any[String])).thenReturn(Fox.successful(()))
      when(folderDAO.assertUpdateAccess(any[ObjectId])(any[AuthorizedAccessContext])).thenReturn(Fox.successful(()))
      when(datasetService.createPreliminaryDataset(any[String], any[String], any[DataStore], any[Boolean]))
        .thenReturn(Fox.successful(dataset))
      when(datasetDAO.updateFolder(any[ObjectId], any[ObjectId])(any[GlobalAccessContext.type])).thenReturn(Fox.successful(()))
      when(datasetService.addInitialTeams(any[Dataset], any[Option[List[ObjectId]]], any[User])(any[AuthorizedAccessContext]))
        .thenReturn(Fox.successful(()))
      when(datasetService.addUploader(any[Dataset], any[ObjectId])(any[AuthorizedAccessContext]))
        .thenReturn(Fox.successful(()))

      val request = FakeRequest(POST, "/data/datasets/reserveUpload")
        .withJsonBody(Json.toJson(uploadInfo))
      val result = controller.reserveDatasetUpload("test", "key", "token")(request)

      status(result) mustBe OK
    }

    "handle reserveDatasetUpload with storage exceeded" in {
      val uploadInfo = ReserveUploadInformation(
        name = "test-dataset",
        organization = organizationId,
        totalFileSizeInBytes = Some(Long.MaxValue), // Exceed storage
        folderId = Some(ObjectId.dummyId.toString),
        initialTeams = None,
        layersToLink = None,
        requireUniqueName = Some(true)
      )

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type])).thenReturn(Fox.successful(organization))
      when(organizationDAO.getUsedStorage(any[ObjectId])).thenReturn(Fox.successful(1000L))

      val request = FakeRequest(POST, "/data/datasets/reserveUpload")
        .withJsonBody(Json.toJson(uploadInfo))
      val result = controller.reserveDatasetUpload("test", "key", "token")(request)

      status(result) mustBe FORBIDDEN
    }

    "handle reserveDatasetUpload with invalid organization mismatch" in {
      val uploadInfo = ReserveUploadInformation(
        name = "test-dataset",
        organization = organizationId,
        totalFileSizeInBytes = Some(1000L),
        folderId = Some(ObjectId.dummyId.toString),
        initialTeams = None,
        layersToLink = None,
        requireUniqueName = Some(false)
      )

      val differentOrgUser = mock[User]
      when(differentOrgUser._organization).thenReturn(ObjectId.dummyId)

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(differentOrgUser))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type])).thenReturn(Fox.successful(organization))
      when(organizationDAO.getUsedStorage(any[ObjectId])).thenReturn(Fox.successful(500L))

      val request = FakeRequest(POST, "/data/datasets/reserveUpload")
        .withJsonBody(Json.toJson(uploadInfo))
      val result = controller.reserveDatasetUpload("test", "key", "token")(request)

      status(result) mustBe FORBIDDEN
    }

    "return unfinished uploads for user" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetService.getAllUnfinishedDatasetUploadsOfUser(any[ObjectId], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(List(dataset)))
      when(teamDAO.findAllowedTeamIdsForDataset(any[ObjectId]))
        .thenReturn(Fox.successful(List(ObjectId.dummyId)))

      val request = FakeRequest(GET, "/data/datasets/unfinished")
      val result = controller.getUnfinishedUploadsForUser("test", "key", "token", organizationId)(request)

      status(result) mustBe OK
    }

    "handle getUnfinishedUploadsForUser with invalid organization" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.failure("organization.notFound"))

      val request = FakeRequest(GET, "/data/datasets/unfinished")
      val result = controller.getUnfinishedUploadsForUser("test", "key", "token", "invalid-org")(request)

      status(result) mustBe NOT_FOUND
    }

    "handle getUnfinishedUploadsForUser with empty dataset list" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetService.getAllUnfinishedDatasetUploadsOfUser(any[ObjectId], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(List.empty))

      val request = FakeRequest(GET, "/data/datasets/unfinished")
      val result = controller.getUnfinishedUploadsForUser("test", "key", "token", organizationId)(request)

      status(result) mustBe OK
      contentAsJson(result) mustBe Json.toJson(List.empty[UnfinishedUpload])
    }

    "report successful dataset upload" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(datasetDAO.findOneByDirectoryNameAndOrganization(any[String], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(usedStorageService.refreshStorageReportForDataset(any[Dataset])).thenReturn(Fox.successful(()))

      val request = FakeRequest(POST, "/data/datasets/reportUpload")
      val result = controller.reportDatasetUpload("test", "key", "token", "test-dir", 1000L, false, false)(request)

      status(result) mustBe OK
      val json = contentAsJson(result)
      (json \ "id").as[String] mustBe datasetId.toString
    }

    "handle reportDatasetUpload with invalid dataset" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(datasetDAO.findOneByDirectoryNameAndOrganization(any[String], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.failure("dataset.notFound"))

      val request = FakeRequest(POST, "/data/datasets/reportUpload")
      val result = controller.reportDatasetUpload("test", "key", "token", "invalid-dataset", 1000L, false, false)(request)

      status(result) mustBe NOT_FOUND
    }

    "handle reportDatasetUpload with conversion needed" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(datasetDAO.findOneByDirectoryNameAndOrganization(any[String], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))

      val request = FakeRequest(POST, "/data/datasets/reportUpload")
      val result = controller.reportDatasetUpload("test", "key", "token", "test-dir", 1000L, true, false)(request)

      status(result) mustBe OK
      verify(usedStorageService, never()).refreshStorageReportForDataset(any[Dataset])
      verify(mailchimpClient, never()).tagUser(any[User], any[MailchimpTag])
    }

    "update datastore status" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(dataStoreDAO.updateUrlByName(any[String], any[String])).thenReturn(Fox.successful(()))
      when(dataStoreDAO.updateReportUsedStorageEnabledByName(any[String], any[Boolean]))
        .thenReturn(Fox.successful(()))

      val statusUpdate = DataStoreStatus(ok = true, url = "http://test.com", reportUsedStorageEnabled = Some(true))
      val request = FakeRequest(POST, "/data/status")
        .withJsonBody(Json.toJson(statusUpdate))
      val result = controller.statusUpdate("test", "key")(request)

      status(result) mustBe OK
    }

    "handle statusUpdate with partial information" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(dataStoreDAO.updateUrlByName(any[String], any[String])).thenReturn(Fox.successful(()))
      when(dataStoreDAO.updateReportUsedStorageEnabledByName(any[String], any[Boolean]))
        .thenReturn(Fox.successful(()))

      val statusUpdate = DataStoreStatus(ok = false, url = "http://new-url.com", reportUsedStorageEnabled = None)
      val request = FakeRequest(POST, "/data/status")
        .withJsonBody(Json.toJson(statusUpdate))
      val result = controller.statusUpdate("test", "key")(request)

      status(result) mustBe OK
      verify(dataStoreDAO).updateReportUsedStorageEnabledByName("test", false)
    }

    "update all datasources" in {
      val inboxDataSource = mock[InboxDataSource]
      when(inboxDataSource.isUsable).thenReturn(true)

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetService.updateDataSources(any[DataStore], any[List[InboxDataSource]])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(List(DataSourceId("test", "org"))))
      when(datasetService.deactivateUnreportedDataSources(any[List[DataSourceId]], any[DataStore]))
        .thenReturn(Fox.successful(()))

      val dataSources = List(inboxDataSource)
      val request = FakeRequest(POST, "/data/datasets")
        .withJsonBody(Json.toJson(dataSources))
      val result = controller.updateAll("test", "key")(request)

      status(result) mustBe OK
    }

    "handle updateAll with empty datasource list" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetService.updateDataSources(any[DataStore], any[List[InboxDataSource]])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(List.empty[DataSourceId]))
      when(datasetService.deactivateUnreportedDataSources(any[List[DataSourceId]], any[DataStore]))
        .thenReturn(Fox.successful(()))

      val request = FakeRequest(POST, "/data/datasets")
        .withJsonBody(Json.toJson(List.empty[InboxDataSource]))
      val result = controller.updateAll("test", "key")(request)

      status(result) mustBe OK
    }

    "update single datasource" in {
      val inboxDataSource = mock[InboxDataSource]

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetService.updateDataSources(any[DataStore], any[List[InboxDataSource]])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(List.empty))

      val request = FakeRequest(POST, "/data/datasets/updateOne")
        .withJsonBody(Json.toJson(inboxDataSource))
      val result = controller.updateOne("test", "key")(request)

      status(result) mustBe OK
    }

    "update paths" in {
      val pathInfo = mock[DataSourcePathInfo]

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetService.updateRealPaths(any[List[DataSourcePathInfo]])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(()))

      val request = FakeRequest(POST, "/data/paths")
        .withJsonBody(Json.toJson(List(pathInfo)))
      val result = controller.updatePaths("test", "key")(request)

      status(result) mustBe OK
    }

    "delete dataset" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOneByDataSourceId(any[DataSourceId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(annotationDAO.countAllByDataset(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(0))
      when(datasetDAO.deleteDataset(any[ObjectId], any[Boolean]))
        .thenReturn(Fox.successful(()))
      when(usedStorageService.refreshStorageReportForDataset(any[Dataset]))
        .thenReturn(Fox.successful(()))

      val dataSourceId = DataSourceId("test", organizationId)
      val request = FakeRequest(DELETE, "/data/datasets/delete")
        .withJsonBody(Json.toJson(dataSourceId))
      val result = controller.deleteDataset("test", "key")(request)

      status(result) mustBe OK
    }

    "handle deleteDataset with annotations present" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOneByDataSourceId(any[DataSourceId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(annotationDAO.countAllByDataset(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(5)) // Has annotations
      when(datasetDAO.deleteDataset(any[ObjectId], any[Boolean]))
        .thenReturn(Fox.successful(()))
      when(usedStorageService.refreshStorageReportForDataset(any[Dataset]))
        .thenReturn(Fox.successful(()))

      val dataSourceId = DataSourceId("test", organizationId)
      val request = FakeRequest(DELETE, "/data/datasets/delete")
        .withJsonBody(Json.toJson(dataSourceId))
      val result = controller.deleteDataset("test", "key")(request)

      status(result) mustBe OK
      verify(datasetDAO).deleteDataset(dataset._id, onlyMarkAsDeleted = true)
    }

    "delete virtual dataset" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetDAO.deleteDataset(any[ObjectId], any[Boolean]))
        .thenReturn(Fox.successful(()))

      val request = FakeRequest(DELETE, "/data/datasets/deleteVirtual")
        .withJsonBody(Json.toJson(dataset._id))
      val result = controller.deleteVirtualDataset("test", "key")(request)

      status(result) mustBe OK
    }

    "handle deleteVirtualDataset with non-virtual dataset" in {
      val nonVirtualDataset = mock[Dataset]
      when(nonVirtualDataset.isVirtual).thenReturn(false)

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(nonVirtualDataset))

      val request = FakeRequest(DELETE, "/data/datasets/deleteVirtual")
        .withJsonBody(Json.toJson(dataset._id))
      val result = controller.deleteVirtualDataset("test", "key")(request)

      status(result) mustBe FORBIDDEN
    }

    "find dataset id" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetDAO.findOneByNameAndOrganization(any[String], any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))

      val request = FakeRequest(GET, "/data/datasets/findId")
      val result = controller.findDatasetId("test", "key", "test-dataset", organizationId)(request)

      status(result) mustBe OK
      contentAsJson(result) mustBe Json.toJson(dataset._id)
    }

    "get paths for dataset" in {
      val datasetLayer = mock[DatasetLayer]
      when(datasetLayer.name).thenReturn("layer1")

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetLayerDAO.findAllForDataset(any[ObjectId]))
        .thenReturn(Fox.successful(List(datasetLayer)))
      when(datasetService.getPathsForDataLayer(any[ObjectId], any[String]))
        .thenReturn(Fox.successful(List(("mag1" -> List("linkedMag1")))))

      val request = FakeRequest(GET, s"/data/datasets/${dataset._id}/paths")
      val result = controller.getPaths("test", "key", dataset._id)(request)

      status(result) mustBe OK
    }

    "handle getPaths with empty layers" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetLayerDAO.findAllForDataset(any[ObjectId]))
        .thenReturn(Fox.successful(List.empty))

      val request = FakeRequest(GET, s"/data/datasets/${dataset._id}/paths")
      val result = controller.getPaths("test", "key", dataset._id)(request)

      status(result) mustBe OK
      contentAsJson(result) mustBe Json.toJson(List.empty[LayerMagLinkInfo])
    }

    "get data source" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetService.fullDataSourceFor(any[Dataset]))
        .thenReturn(Fox.successful(dataSource))

      val request = FakeRequest(GET, s"/data/datasets/${dataset._id}/datasource")
      val result = controller.getDataSource("test", "key", dataset._id)(request)

      status(result) mustBe OK
    }

    "register data source" in {
      val registrationInfo = mock[DataSourceRegistrationInfo]
      when(registrationInfo.dataSource).thenReturn(dataSource)
      when(registrationInfo.folderId).thenReturn(Some(ObjectId.dummyId))

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(bearerTokenService.userForToken(any[String])).thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetService.createVirtualDataset(any[String], any[String], any[DataStore], any[DataSource], any[Option[ObjectId]], any[User]))
        .thenReturn(Fox.successful(dataset))

      val request = FakeRequest(POST, "/data/datasets/register")
        .withJsonBody(Json.toJson(registrationInfo))
      val result = controller.registerDataSource("test", "key", organizationId, "test-dir", "token")(request)

      status(result) mustBe OK
      contentAsString(result) mustBe dataset._id.toString
    }

    "update data source" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetService.fullDataSourceFor(any[Dataset]))
        .thenReturn(Fox.successful(dataSource))
      when(datasetDAO.updateDataSourceByDatasetId(any[ObjectId], any[String], any[Int], any[AbstractDataSource], any[Boolean])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(()))

      val request = FakeRequest(PUT, s"/data/datasets/${dataset._id}/updateDataSource")
        .withJsonBody(Json.toJson(dataSource))
      val result = controller.updateDataSource("test", "key", dataset._id, allowNewPaths = true)(request)

      status(result) mustBe OK
    }

    "handle updateDataSource with new paths when not allowed" in {
      val newDataSource = mock[DataSource]
      when(newDataSource.allExplicitPaths).thenReturn(List("/new/path", "/existing/path"))
      when(newDataSource.dataLayers).thenReturn(List.empty)

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(datasetDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(dataset))
      when(datasetService.fullDataSourceFor(any[Dataset]))
        .thenReturn(Fox.successful(dataSource))

      val request = FakeRequest(PUT, s"/data/datasets/${dataset._id}/updateDataSource")
        .withJsonBody(Json.toJson(newDataSource))
      val result = controller.updateDataSource("test", "key", dataset._id, allowNewPaths = false)(request)

      status(result) mustBe BAD_REQUEST
    }

    "get job export properties" in {
      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(jobDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(job))
      when(userDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(user))
      when(organizationDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))

      val request = FakeRequest(GET, s"/data/jobs/${job._id}/properties")
      val result = controller.jobExportProperties("test", "key", job._id)(request)

      status(result) mustBe OK
      val json = contentAsJson(result)
      (json \ "jobId").as[String] mustBe job._id.toString
    }

    "handle jobExportProperties with no latest run" in {
      val jobWithoutRun = mock[Job]
      when(jobWithoutRun.latestRunId).thenReturn(None)

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(jobDAO.findOne(any[ObjectId])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(jobWithoutRun))

      val request = FakeRequest(GET, s"/data/jobs/${job._id}/properties")
      val result = controller.jobExportProperties("test", "key", job._id)(request)

      status(result) mustBe BAD_REQUEST
    }

    "find credential" in {
      val credential = mock[Credential]

      when(dataStoreService.validateAccess(any[String], any[String])(any[DataStore => Fox[Result]]))
        .thenAnswer((invocation: InvocationOnMock) => {
          val callback = invocation.getArgument[DataStore => Fox[Result]](2)
          callback(dataStore)
        })

      when(credentialDAO.findOne(any[ObjectId]))
        .thenReturn(Fox.successful(credential))

      val request = FakeRequest(GET, s"/data/credentials/${ObjectId.dummyId}")
      val result = controller.findCredential("test", "key", ObjectId.dummyId)(request)

      status(result) mustBe OK
    }
  }

  "validateLayerToLink" should {

    "accept valid layer link for public dataset" in {
      val layerIdentifier = LinkedLayerIdentifier(
        organizationId = Some(organizationId),
        dataSetName = "test-dataset",
        layerName = "test-layer"
      )

      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetDAO.findOneByNameAndOrganization(any[String], any[ObjectId])(any[AuthorizedAccessContext]))
        .thenReturn(Fox.successful(dataset))
      when(userService.isTeamManagerOrAdminOfOrg(any[User], any[ObjectId]))
        .thenReturn(Fox.successful(false))

      val result = await(controller.validateLayerToLink(layerIdentifier, user).futureBox)
      result.isDefined mustBe true
    }

    "reject layer link with invalid organization" in {
      val invalidLayerIdentifier = LinkedLayerIdentifier(
        organizationId = Some("invalid-org"),
        dataSetName = "test-dataset",
        layerName = "test-layer"
      )

      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.failure("organization.notFound"))

      val result = await(controller.validateLayerToLink(invalidLayerIdentifier, user).futureBox)
      result.isEmpty mustBe true
    }

    "reject layer link for non-manager user with private dataset" in {
      val privateDataset = mock[Dataset]
      when(privateDataset.isPublic).thenReturn(false)
      when(privateDataset.directoryName).thenReturn("private-dir")
      when(privateDataset._organization).thenReturn(ObjectId.fromString(organizationId).get)

      val regularUser = mock[User]
      when(regularUser.isDatasetManager).thenReturn(false)

      val layerIdentifier = LinkedLayerIdentifier(
        organizationId = Some(organizationId),
        dataSetName = "private-dataset",
        layerName = "test-layer"
      )

      when(organizationDAO.findOne(any[String])(any[GlobalAccessContext.type]))
        .thenReturn(Fox.successful(organization))
      when(datasetDAO.findOneByNameAndOrganization(any[String], any[ObjectId])(any[AuthorizedAccessContext]))
        .thenReturn(Fox.successful(privateDataset))
      when(userService.isTeamManagerOrAdminOfOrg(any[User], any[ObjectId]))
        .thenReturn(Fox.successful(false))

      val result = await(controller.validateLayerToLink(layerIdentifier, regularUser).futureBox)
      result.isEmpty mustBe true
    }
  }
}