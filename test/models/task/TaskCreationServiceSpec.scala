package models.task

import java.io.File
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracingsWithIds, StringOpt}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.tracingstore.tracings.{TracingId, TracingType}
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import models.annotation.nml.NmlResults.TracingBoxContainer
import models.annotation._
import models.dataset.{Dataset, DatasetDAO, DatasetService}
import models.project.{Project, ProjectDAO}
import models.team.{Team, TeamDAO, TeamService}
import models.user.{User, UserDAO, UserExperiencesDAO, UserService}
import play.api.i18n.MessagesProvider
import play.api.libs.json.Json
import telemetry.SlackNotificationService
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import org.scalatestplus.play.PlaySpec
import org.mockito.Mockito._
import org.mockito.ArgumentMatchers._
import org.scalatestplus.mockito.MockitoSugar
import scala.concurrent.{ExecutionContext, Future}
import play.api.test.Helpers._

class TaskCreationServiceSpec extends PlaySpec with MockitoSugar {
  
  implicit val ec: ExecutionContext = ExecutionContext.global
  implicit val ctx: DBAccessContext = mock[DBAccessContext]
  implicit val messagesProvider: MessagesProvider = mock[MessagesProvider]
  
  // Mock all dependencies
  val mockAnnotationService = mock[AnnotationService]
  val mockTaskDAO = mock[TaskDAO]
  val mockTaskService = mock[TaskService]
  val mockUserService = mock[UserService]
  val mockTeamDAO = mock[TeamDAO]
  val mockTeamService = mock[TeamService]
  val mockUserDAO = mock[UserDAO]
  val mockSlackNotificationService = mock[SlackNotificationService]
  val mockProjectDAO = mock[ProjectDAO]
  val mockAnnotationDAO = mock[AnnotationDAO]
  val mockUserExperiencesDAO = mock[UserExperiencesDAO]
  val mockScriptDAO = mock[ScriptDAO]
  val mockDatasetDAO = mock[DatasetDAO]
  val mockDatasetService = mock[DatasetService]
  val mockTracingStoreService = mock[TracingStoreService]
  
  val taskCreationService = new TaskCreationService(
    mockAnnotationService, mockTaskDAO, mockTaskService, mockUserService,
    mockTeamDAO, mockTeamService, mockUserDAO, mockSlackNotificationService,
    mockProjectDAO, mockAnnotationDAO, mockUserExperiencesDAO, mockScriptDAO,
    mockDatasetDAO, mockDatasetService, mockTracingStoreService
  )
  
  "TaskCreationService" should {
    
    "assertBatchLimit" should {
      
      "allow batch sizes within limits for skeleton tasks" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val result = await(taskCreationService.assertBatchLimit(500, skeletonTaskType).futureBox)
        result mustBe Full(())
      }
      
      "allow batch sizes within limits for volume tasks" in {
        val volumeTaskType = mock[TaskType]
        when(volumeTaskType.tracingType).thenReturn(TracingType.volume)
        
        val result = await(taskCreationService.assertBatchLimit(50, volumeTaskType).futureBox)
        result mustBe Full(())
      }
      
      "allow batch sizes within limits for hybrid tasks" in {
        val hybridTaskType = mock[TaskType]
        when(hybridTaskType.tracingType).thenReturn(TracingType.hybrid)
        
        val result = await(taskCreationService.assertBatchLimit(80, hybridTaskType).futureBox)
        result mustBe Full(())
      }
      
      "reject batch sizes exceeding limits for skeleton tasks" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val result = await(taskCreationService.assertBatchLimit(1500, skeletonTaskType).futureBox)
        result must matchPattern { case _: Failure => }
      }
      
      "reject batch sizes exceeding limits for volume tasks" in {
        val volumeTaskType = mock[TaskType]
        when(volumeTaskType.tracingType).thenReturn(TracingType.volume)
        
        val result = await(taskCreationService.assertBatchLimit(200, volumeTaskType).futureBox)
        result must matchPattern { case _: Failure => }
      }
      
      "reject batch sizes exceeding limits for hybrid tasks" in {
        val hybridTaskType = mock[TaskType]
        when(hybridTaskType.tracingType).thenReturn(TracingType.hybrid)
        
        val result = await(taskCreationService.assertBatchLimit(150, hybridTaskType).futureBox)
        result must matchPattern { case _: Failure => }
      }
      
      "handle edge case of exact limit for skeleton tasks" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val result = await(taskCreationService.assertBatchLimit(1000, skeletonTaskType).futureBox)
        result mustBe Full(())
      }
      
      "handle edge case of exact limit for volume tasks" in {
        val volumeTaskType = mock[TaskType]
        when(volumeTaskType.tracingType).thenReturn(TracingType.volume)
        
        val result = await(taskCreationService.assertBatchLimit(100, volumeTaskType).futureBox)
        result mustBe Full(())
      }
      
      "handle zero batch size" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val result = await(taskCreationService.assertBatchLimit(0, skeletonTaskType).futureBox)
        result mustBe Full(())
      }
      
      "handle negative batch size" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val result = await(taskCreationService.assertBatchLimit(-1, skeletonTaskType).futureBox)
        result mustBe Full(())
      }
    }
    
    "createTaskSkeletonTracingBases" should {
      
      "create skeleton tracing bases when needed" in {
        val boundingBox = Some(BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100))
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        val skeletonTracing = mock[SkeletonTracing]
        
        when(mockAnnotationService.createSkeletonTracingBase(boundingBox, editPosition, editRotation))
          .thenReturn(skeletonTracing)
        
        val taskParams = createTaskParameters(
          boundingBox = boundingBox,
          editPosition = editPosition,
          editRotation = editRotation,
          baseAnnotation = None,
          newSkeletonTracingId = Some(TracingId.generate)
        )
        
        val result = taskCreationService.createTaskSkeletonTracingBases(List(taskParams))
        
        result must have length 1
        result.head mustBe Some(skeletonTracing)
      }
      
      "not create skeleton tracing bases when base annotation exists" in {
        val taskParams = createTaskParameters(
          baseAnnotation = Some(mock[BaseAnnotation]),
          newSkeletonTracingId = Some(TracingId.generate)
        )
        
        val result = taskCreationService.createTaskSkeletonTracingBases(List(taskParams))
        
        result must have length 1
        result.head mustBe None
      }
      
      "not create skeleton tracing bases when skeleton tracing ID is not defined" in {
        val taskParams = createTaskParameters(
          baseAnnotation = None,
          newSkeletonTracingId = None
        )
        
        val result = taskCreationService.createTaskSkeletonTracingBases(List(taskParams))
        
        result must have length 1
        result.head mustBe None
      }
      
      "handle empty task parameters list" in {
        val result = taskCreationService.createTaskSkeletonTracingBases(List.empty)
        result mustBe empty
      }
      
      "handle multiple task parameters with mixed conditions" in {
        val boundingBox = Some(BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100))
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        val skeletonTracing = mock[SkeletonTracing]
        
        when(mockAnnotationService.createSkeletonTracingBase(boundingBox, editPosition, editRotation))
          .thenReturn(skeletonTracing)
        
        val taskParams1 = createTaskParameters(
          boundingBox = boundingBox,
          editPosition = editPosition,
          editRotation = editRotation,
          baseAnnotation = None,
          newSkeletonTracingId = Some(TracingId.generate)
        )
        
        val taskParams2 = createTaskParameters(
          baseAnnotation = Some(mock[BaseAnnotation]),
          newSkeletonTracingId = Some(TracingId.generate)
        )
        
        val result = taskCreationService.createTaskSkeletonTracingBases(List(taskParams1, taskParams2))
        
        result must have length 2
        result.head mustBe Some(skeletonTracing)
        result(1) mustBe None
      }
    }
    
    "createTaskVolumeTracingBases" should {
      
      "create volume tracing bases when needed" in {
        val boundingBox = Some(BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100))
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        val datasetId = ObjectId.generate
        val volumeTracing = mock[VolumeTracing]
        val magRestrictions = mock[MagRestrictions]
        val taskTypeSettings = mock[TaskTypeSettings]
        val taskType = mock[TaskType]
        
        when(taskType.settings).thenReturn(taskTypeSettings)
        when(taskTypeSettings.magRestrictions).thenReturn(magRestrictions)
        when(mockAnnotationService.createVolumeTracingBase(
          datasetId, boundingBox, editPosition, editRotation,
          volumeShowFallbackLayer = false, magRestrictions = magRestrictions
        )).thenReturn(Fox.successful(volumeTracing))
        
        val taskParams = createTaskParameters(
          boundingBox = boundingBox,
          datasetId = datasetId,
          editPosition = editPosition,
          editRotation = editRotation,
          baseAnnotation = None,
          newVolumeTracingId = Some(TracingId.generate)
        )
        
        val result = await(taskCreationService.createTaskVolumeTracingBases(List(taskParams), taskType).futureBox)
        
        result mustBe Full(List(Some((volumeTracing, None))))
      }
      
      "not create volume tracing bases when base annotation exists" in {
        val taskType = mock[TaskType]
        val taskParams = createTaskParameters(
          baseAnnotation = Some(mock[BaseAnnotation]),
          newVolumeTracingId = Some(TracingId.generate)
        )
        
        val result = await(taskCreationService.createTaskVolumeTracingBases(List(taskParams), taskType).futureBox)
        
        result mustBe Full(List(None))
      }
      
      "not create volume tracing bases when volume tracing ID is not defined" in {
        val taskType = mock[TaskType]
        val taskParams = createTaskParameters(
          baseAnnotation = None,
          newVolumeTracingId = None
        )
        
        val result = await(taskCreationService.createTaskVolumeTracingBases(List(taskParams), taskType).futureBox)
        
        result mustBe Full(List(None))
      }
      
      "handle empty task parameters list" in {
        val taskType = mock[TaskType]
        val result = await(taskCreationService.createTaskVolumeTracingBases(List.empty, taskType).futureBox)
        
        result mustBe Full(List.empty)
      }
    }
    
    "buildFullParamsFromFiles" should {
      
      "build full parameters from skeleton tracing successfully" in {
        val nmlParams = createNmlTaskParameters()
        val skeletonTracing = mock[SkeletonTracing]
        val boundingBox = Some(BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100))
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        val datasetId = ObjectId.generate
        val fileName = "test.nml"
        
        when(skeletonTracing.boundingBox).thenReturn(boundingBox)
        when(skeletonTracing.editPosition).thenReturn(editPosition)
        when(skeletonTracing.editRotation).thenReturn(editRotation)
        
        val tracingBoxContainer = TracingBoxContainer(
          skeleton = Full(skeletonTracing),
          volume = Empty,
          datasetId = Full(datasetId),
          fileName = Full(fileName),
          description = Full(None)
        )
        
        val result = taskCreationService.buildFullParamsFromFiles(nmlParams, List(tracingBoxContainer))
        
        result must have length 1
        result.head must matchPattern { case Full(_) => }
        
        val taskParams = result.head.openOrThrowException("Expected Full result")
        taskParams.datasetId mustBe datasetId
        taskParams.editPosition mustBe editPosition
        taskParams.editRotation mustBe editRotation
        taskParams.fileName mustBe Some(fileName)
      }
      
      "build full parameters from volume tracing when skeleton is empty" in {
        val nmlParams = createNmlTaskParameters()
        val volumeLayer = mock[UploadedVolumeLayer]
        val volumeTracing = mock[VolumeTracing]
        val boundingBox = BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100)
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        val datasetId = ObjectId.generate
        val fileName = "test.nml"
        
        when(volumeLayer.tracing).thenReturn(volumeTracing)
        when(volumeTracing.boundingBox).thenReturn(boundingBox)
        when(volumeTracing.editPosition).thenReturn(editPosition)
        when(volumeTracing.editRotation).thenReturn(editRotation)
        
        val tracingBoxContainer = TracingBoxContainer(
          skeleton = Empty,
          volume = Full((volumeLayer, None)),
          datasetId = Full(datasetId),
          fileName = Full(fileName),
          description = Full(None)
        )
        
        val result = taskCreationService.buildFullParamsFromFiles(nmlParams, List(tracingBoxContainer))
        
        result must have length 1
        result.head must matchPattern { case Full(_) => }
        
        val taskParams = result.head.openOrThrowException("Expected Full result")
        taskParams.datasetId mustBe datasetId
        taskParams.editPosition mustBe editPosition
        taskParams.editRotation mustBe editRotation
        taskParams.fileName mustBe Some(fileName)
      }
      
      "handle failure when no skeleton or volume tracing is provided" in {
        val nmlParams = createNmlTaskParameters()
        
        val tracingBoxContainer = TracingBoxContainer(
          skeleton = Empty,
          volume = Empty,
          datasetId = Full(ObjectId.generate),
          fileName = Full("test.nml"),
          description = Full(None)
        )
        
        val result = taskCreationService.buildFullParamsFromFiles(nmlParams, List(tracingBoxContainer))
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
      }
      
      "handle failure when dataset ID is missing" in {
        val nmlParams = createNmlTaskParameters()
        val skeletonTracing = mock[SkeletonTracing]
        
        val tracingBoxContainer = TracingBoxContainer(
          skeleton = Full(skeletonTracing),
          volume = Empty,
          datasetId = Empty,
          fileName = Full("test.nml"),
          description = Full(None)
        )
        
        val result = taskCreationService.buildFullParamsFromFiles(nmlParams, List(tracingBoxContainer))
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
      }
    }
    
    "addVolumeFallbackBoundingBoxes" should {
      
      "add fallback bounding box when volume bounding box is empty" in {
        val datasetId = ObjectId.generate
        val dataset = mock[Dataset]
        val dataSource = mock[DataSourceLike]
        val fallbackBoundingBox = BoundingBox(Vec3Int(0, 0, 0), 200, 200, 200)
        val volumeTracing = mock[VolumeTracing]
        val uploadedVolumeLayer = mock[UploadedVolumeLayer]
        val updatedVolumeTracing = mock[VolumeTracing]
        val updatedUploadedVolumeLayer = mock[UploadedVolumeLayer]
        val file = mock[File]
        
        when(volumeTracing.boundingBox).thenReturn(BoundingBox.empty)
        when(uploadedVolumeLayer.tracing).thenReturn(volumeTracing)
        when(mockDatasetDAO.findOne(datasetId)(GlobalAccessContext)).thenReturn(Fox.successful(dataset))
        when(mockDatasetService.dataSourceFor(dataset)).thenReturn(Fox.successful(Some(dataSource)))
        when(dataSource.toUsable).thenReturn(Some(dataSource))
        when(dataSource.boundingBox).thenReturn(fallbackBoundingBox)
        when(volumeTracing.copy(boundingBox = fallbackBoundingBox)).thenReturn(updatedVolumeTracing)
        when(uploadedVolumeLayer.copy(tracing = updatedVolumeTracing)).thenReturn(updatedUploadedVolumeLayer)
        
        val tracingBox = TracingBoxContainer(
          skeleton = Empty,
          volume = Full((uploadedVolumeLayer, Some(file))),
          datasetId = Full(datasetId),
          fileName = Full("test.nml"),
          description = Full(None)
        )
        
        val result = await(taskCreationService.addVolumeFallbackBoundingBoxes(List(tracingBox)).futureBox)
        
        result must matchPattern { case Full(_) => }
        verify(mockDatasetDAO).findOne(datasetId)(GlobalAccessContext)
        verify(mockDatasetService).dataSourceFor(dataset)
      }
      
      "not modify volume tracing when bounding box is not empty" in {
        val datasetId = ObjectId.generate
        val volumeTracing = mock[VolumeTracing]
        val uploadedVolumeLayer = mock[UploadedVolumeLayer]
        val nonEmptyBoundingBox = BoundingBox(Vec3Int(10, 10, 10), 100, 100, 100)
        val file = mock[File]
        
        when(volumeTracing.boundingBox).thenReturn(nonEmptyBoundingBox)
        when(uploadedVolumeLayer.tracing).thenReturn(volumeTracing)
        
        val tracingBox = TracingBoxContainer(
          skeleton = Empty,
          volume = Full((uploadedVolumeLayer, Some(file))),
          datasetId = Full(datasetId),
          fileName = Full("test.nml"),
          description = Full(None)
        )
        
        val result = await(taskCreationService.addVolumeFallbackBoundingBoxes(List(tracingBox)).futureBox)
        
        result must matchPattern { case Full(_) => }
        verify(mockDatasetDAO, never()).findOne(any[ObjectId])(any[DBAccessContext])
      }
      
      "handle tracing boxes without volume" in {
        val skeletonTracing = mock[SkeletonTracing]
        val tracingBox = TracingBoxContainer(
          skeleton = Full(skeletonTracing),
          volume = Empty,
          datasetId = Full(ObjectId.generate),
          fileName = Full("test.nml"),
          description = Full(None)
        )
        
        val result = await(taskCreationService.addVolumeFallbackBoundingBoxes(List(tracingBox)).futureBox)
        
        result must matchPattern { case Full(_) => }
        result.openOrThrowException("Expected successful result") must have length 1
        result.openOrThrowException("Expected successful result").head mustBe tracingBox
      }
      
      "handle empty list" in {
        val result = await(taskCreationService.addVolumeFallbackBoundingBoxes(List.empty).futureBox)
        
        result must matchPattern { case Full(_) => }
        result.openOrThrowException("Expected successful result") mustBe empty
      }
    }
    
    "addNewIdsToTaskParameters" should {
      
      "add skeleton and volume IDs for hybrid task type" in {
        val hybridTaskType = mock[TaskType]
        when(hybridTaskType.tracingType).thenReturn(TracingType.hybrid)
        
        val originalParams = createTaskParameters(
          newAnnotationId = None,
          newSkeletonTracingId = None,
          newVolumeTracingId = None
        )
        
        val result = taskCreationService.addNewIdsToTaskParameters(List(originalParams), hybridTaskType)
        
        result must have length 1
        val updatedParams = result.head
        updatedParams.newAnnotationId mustBe defined
        updatedParams.newSkeletonTracingId mustBe defined
        updatedParams.newVolumeTracingId mustBe defined
      }
      
      "add only skeleton ID for skeleton task type" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val originalParams = createTaskParameters(
          newAnnotationId = None,
          newSkeletonTracingId = None,
          newVolumeTracingId = None
        )
        
        val result = taskCreationService.addNewIdsToTaskParameters(List(originalParams), skeletonTaskType)
        
        result must have length 1
        val updatedParams = result.head
        updatedParams.newAnnotationId mustBe defined
        updatedParams.newSkeletonTracingId mustBe defined
        updatedParams.newVolumeTracingId must not be defined
      }
      
      "add only volume ID for volume task type" in {
        val volumeTaskType = mock[TaskType]
        when(volumeTaskType.tracingType).thenReturn(TracingType.volume)
        
        val originalParams = createTaskParameters(
          newAnnotationId = None,
          newSkeletonTracingId = None,
          newVolumeTracingId = None
        )
        
        val result = taskCreationService.addNewIdsToTaskParameters(List(originalParams), volumeTaskType)
        
        result must have length 1
        val updatedParams = result.head
        updatedParams.newAnnotationId mustBe defined
        updatedParams.newSkeletonTracingId must not be defined
        updatedParams.newVolumeTracingId mustBe defined
      }
      
      "handle empty parameters list" in {
        val hybridTaskType = mock[TaskType]
        val result = taskCreationService.addNewIdsToTaskParameters(List.empty, hybridTaskType)
        result mustBe empty
      }
      
      "generate unique IDs for multiple parameters" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val originalParams1 = createTaskParameters(newAnnotationId = None, newSkeletonTracingId = None)
        val originalParams2 = createTaskParameters(newAnnotationId = None, newSkeletonTracingId = None)
        
        val result = taskCreationService.addNewIdsToTaskParameters(List(originalParams1, originalParams2), skeletonTaskType)
        
        result must have length 2
        result.head.newAnnotationId must not equal result(1).newAnnotationId
        result.head.newSkeletonTracingId must not equal result(1).newSkeletonTracingId
      }
    }
    
    "combineParamsWithTracings" should {
      
      "combine valid parameters with tracings" in {
        val taskParams = mock[TaskParameters]
        val skeletonTracing = mock[SkeletonTracing]
        val volumeTracing = mock[VolumeTracing]
        val file = mock[File]
        
        val fullParams = List(Full(taskParams))
        val skeletonBases = List(Full(skeletonTracing))
        val volumeBases = List(Full((volumeTracing, Some(file))))
        
        val result = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case Full(_) => }
        
        val combined = result.head.openOrThrowException("Expected Full result")
        combined._1 mustBe taskParams
        combined._2 mustBe Some(skeletonTracing)
        combined._3 mustBe Some((volumeTracing, Some(file)))
      }
      
      "handle skeleton tracing failure" in {
        val taskParams = mock[TaskParameters]
        val skeletonFailure = Failure("skeleton failure")
        val volumeTracing = mock[VolumeTracing]
        
        val fullParams = List(Full(taskParams))
        val skeletonBases = List(skeletonFailure)
        val volumeBases = List(Full((volumeTracing, None)))
        
        val result = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
        result.head mustBe skeletonFailure
      }
      
      "handle volume tracing failure" in {
        val taskParams = mock[TaskParameters]
        val skeletonTracing = mock[SkeletonTracing]
        val volumeFailure = Failure("volume failure")
        
        val fullParams = List(Full(taskParams))
        val skeletonBases = List(Full(skeletonTracing))
        val volumeBases = List(volumeFailure)
        
        val result = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
        result.head mustBe volumeFailure
      }
      
      "handle task parameters failure" in {
        val paramsFailure = Failure("params failure")
        val skeletonTracing = mock[SkeletonTracing]
        val volumeTracing = mock[VolumeTracing]
        
        val fullParams = List(paramsFailure)
        val skeletonBases = List(Full(skeletonTracing))
        val volumeBases = List(Full((volumeTracing, None)))
        
        val result = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
        result.head mustBe paramsFailure
      }
      
      "handle empty parameters" in {
        val emptyParams = List(Empty)
        val skeletonBases = List(Empty)
        val volumeBases = List(Empty)
        
        val result = taskCreationService.combineParamsWithTracings(emptyParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
      }
      
      "prioritize skeleton failure over volume failure" in {
        val taskParams = mock[TaskParameters]
        val skeletonFailure = Failure("skeleton failure")
        val volumeFailure = Failure("volume failure")
        
        val fullParams = List(Full(taskParams))
        val skeletonBases = List(skeletonFailure)
        val volumeBases = List(volumeFailure)
        
        val result = taskCreationService.combineParamsWithTracings(fullParams, skeletonBases, volumeBases)
        
        result must have length 1
        result.head must matchPattern { case _: Failure => }
        result.head mustBe skeletonFailure
      }
    }
    
    "fillInMissingTracings" should {
      
      "handle skeleton tracing type correctly" in {
        val skeletonTaskType = mock[TaskType]
        when(skeletonTaskType.tracingType).thenReturn(TracingType.skeleton)
        
        val skeletonTracing = mock[SkeletonTracing]
        val volumeLayer = mock[UploadedVolumeLayer]
        val file = mock[File]
        
        val skeletons = List(Full(skeletonTracing))
        val volumes = List(Full((volumeLayer, Some(file))))
        val params = List(Full(mock[TaskParameters]))
        
        val result = await(taskCreationService.fillInMissingTracings(skeletons, volumes, params, skeletonTaskType).futureBox)
        
        result must matchPattern { case Full(_) => }
        val (resultSkeletons, resultVolumes) = result.openOrThrowException("Expected successful result")
        resultSkeletons must have length 1
        resultVolumes must have length 1
        resultSkeletons.head mustBe Full(skeletonTracing)
        resultVolumes.head mustBe Empty
      }
      
      "handle volume tracing type correctly" in {
        val volumeTaskType = mock[TaskType]
        when(volumeTaskType.tracingType).thenReturn(TracingType.volume)
        
        val skeletonTracing = mock[SkeletonTracing]
        val volumeLayer = mock[UploadedVolumeLayer]
        val volumeTracing = mock[VolumeTracing]
        val file = mock[File]
        
        when(volumeLayer.tracing).thenReturn(volumeTracing)
        
        val skeletons = List(Full(skeletonTracing))
        val volumes = List(Full((volumeLayer, Some(file))))
        val params = List(Full(mock[TaskParameters]))
        
        val result = await(taskCreationService.fillInMissingTracings(skeletons, volumes, params, volumeTaskType).futureBox)
        
        result must matchPattern { case Full(_) => }
        val (resultSkeletons, resultVolumes) = result.openOrThrowException("Expected successful result")
        resultSkeletons must have length 1
        resultVolumes must have length 1
        resultSkeletons.head mustBe Empty
        resultVolumes.head mustBe Full((volumeTracing, Some(file)))
      }
      
      "create missing skeleton tracing for hybrid type" in {
        val hybridTaskType = mock[TaskType]
        val taskTypeSettings = mock[TaskTypeSettings]
        val magRestrictions = mock[MagRestrictions]
        
        when(hybridTaskType.tracingType).thenReturn(TracingType.hybrid)
        when(hybridTaskType.settings).thenReturn(taskTypeSettings)
        when(taskTypeSettings.magRestrictions).thenReturn(magRestrictions)
        
        val volumeLayer = mock[UploadedVolumeLayer]
        val volumeTracing = mock[VolumeTracing]
        val createdSkeletonTracing = mock[SkeletonTracing]
        val file = mock[File]
        val taskParams = mock[TaskParameters]
        val boundingBox = Some(BoundingBox(Vec3Int(0, 0, 0), 100, 100, 100))
        val editPosition = Vec3Int(50, 50, 50)
        val editRotation = Vec3Double(0, 0, 0)
        
        when(volumeLayer.tracing).thenReturn(volumeTracing)
        when(taskParams.boundingBox).thenReturn(boundingBox)
        when(taskParams.editPosition).thenReturn(editPosition)
        when(taskParams.editRotation).thenReturn(editRotation)
        when(mockAnnotationService.createSkeletonTracingBase(boundingBox, editPosition, editRotation))
          .thenReturn(createdSkeletonTracing)
        
        val skeletons = List(Empty)
        val volumes = List(Full((volumeLayer, Some(file))))
        val params = List(Full(taskParams))
        
        val result = await(taskCreationService.fillInMissingTracings(skeletons, volumes, params, hybridTaskType).futureBox)
        
        result must matchPattern { case Full(_) => }
        val (resultSkeletons, resultVolumes) = result.openOrThrowException("Expected successful result")
        resultSkeletons must have length 1
        resultVolumes must have length 1
        resultSkeletons.head mustBe Full(createdSkeletonTracing)
        resultVolumes.head mustBe Full((volumeTracing, Some(file)))
      }
    }
  }
  
  // Helper methods for creating test objects
  private def createTaskParameters(
    taskTypeId: ObjectId = ObjectId.generate,
    neededExperience: UserExperience = mock[UserExperience],
    pendingInstances: Int = 1,
    projectName: String = "test-project",
    scriptId: Option[ObjectId] = None,
    boundingBox: Option[BoundingBox] = None,
    datasetId: ObjectId = ObjectId.generate,
    editPosition: Vec3Int = Vec3Int(0, 0, 0),
    editRotation: Vec3Double = Vec3Double(0, 0, 0),
    fileName: Option[String] = None,
    description: Option[String] = None,
    baseAnnotation: Option[BaseAnnotation] = None,
    newAnnotationId: Option[ObjectId] = Some(ObjectId.generate),
    newSkeletonTracingId: Option[TracingId] = None,
    newVolumeTracingId: Option[TracingId] = None
  ): TaskParameters = {
    TaskParameters(
      taskTypeId, neededExperience, pendingInstances, projectName, scriptId,
      boundingBox, datasetId, editPosition, editRotation, fileName, description,
      baseAnnotation, newAnnotationId, newSkeletonTracingId, newVolumeTracingId
    )
  }
  
  private def createNmlTaskParameters(
    taskTypeId: ObjectId = ObjectId.generate,
    neededExperience: UserExperience = mock[UserExperience],
    pendingInstances: Int = 1,
    projectName: String = "test-project",
    scriptId: Option[ObjectId] = None,
    boundingBox: Option[BoundingBox] = None
  ): NmlTaskParameters = {
    val nmlParams = mock[NmlTaskParameters]
    when(nmlParams.taskTypeId).thenReturn(taskTypeId)
    when(nmlParams.neededExperience).thenReturn(neededExperience)
    when(nmlParams.pendingInstances).thenReturn(pendingInstances)
    when(nmlParams.projectName).thenReturn(projectName)
    when(nmlParams.scriptId).thenReturn(scriptId)
    when(nmlParams.boundingBox).thenReturn(boundingBox)
    nmlParams
  }
}