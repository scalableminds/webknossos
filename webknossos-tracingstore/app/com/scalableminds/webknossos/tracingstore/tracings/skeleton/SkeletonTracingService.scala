package com.scalableminds.webknossos.tracingstore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.UpdateAction.SkeletonUpdateAction
import com.scalableminds.webknossos.tracingstore.tracings.{TracingType, _}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating._
import net.liftweb.common.{Empty, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.concurrent.ExecutionContext

class SkeletonTracingService @Inject()(tracingDataStore: TracingDataStore,
                                       val temporaryTracingStore: TemporaryTracingStore[SkeletonTracing],
                                       val handledGroupIdStore: RedisTemporaryStore,
                                       val temporaryTracingIdStore: RedisTemporaryStore,
                                       val uncommittedUpdatesStore: RedisTemporaryStore)(implicit ec: ExecutionContext)
    extends TracingService[SkeletonTracing]
    with KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with FoxImplicits {

  val tracingType: TracingType.Value = TracingType.skeleton

  val tracingStore: FossilDBClient = tracingDataStore.skeletons

  val tracingMigrationService: SkeletonTracingMigrationService.type = SkeletonTracingMigrationService

  implicit val tracingCompanion: SkeletonTracing.type = SkeletonTracing

  implicit val updateActionJsonFormat: SkeletonUpdateAction.skeletonUpdateActionFormat.type =
    SkeletonUpdateAction.skeletonUpdateActionFormat

  def currentVersion(tracingId: String): Fox[Long] =
    tracingDataStore.skeletonUpdates.getVersion(tracingId, mayBeEmpty = Some(true), emptyFallback = Some(0L))

  def currentVersion(tracing: SkeletonTracing): Long = tracing.version

  def handleUpdateGroup(tracingId: String,
                        updateActionGroup: UpdateActionGroup[SkeletonTracing],
                        previousVersion: Long): Fox[_] =
    tracingDataStore.skeletonUpdates.put(
      tracingId,
      updateActionGroup.version,
      updateActionGroup.actions
        .map(_.addTimestamp(updateActionGroup.timestamp)) match { //to the first action in the group, attach the group's info
        case Nil           => Nil
        case first :: rest => first.addInfo(updateActionGroup.info) :: rest
      }
    )

  override def applyPendingUpdates(tracing: SkeletonTracing,
                                   tracingId: String,
                                   desiredVersion: Option[Long]): Fox[SkeletonTracing] = {
    val existingVersion = tracing.version
    findDesiredOrNewestPossibleVersion(tracing, tracingId, desiredVersion).flatMap { newVersion =>
      if (newVersion > existingVersion) {
        for {
          pendingUpdates <- findPendingUpdates(tracingId, existingVersion, newVersion)
          updatedTracing <- update(tracing, tracingId, pendingUpdates, newVersion)
          _ <- save(updatedTracing, Some(tracingId), newVersion)
        } yield {
          updatedTracing
        }
      } else {
        Full(tracing)
      }
    }
  }

  private def findDesiredOrNewestPossibleVersion(tracing: SkeletonTracing,
                                                 tracingId: String,
                                                 desiredVersion: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume tracing is brand new (possibly created from NML,
     * hence the emptyFallbck tracing.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.skeletonUpdates.getVersion(tracingId,
                                                                         mayBeEmpty = Some(true),
                                                                         emptyFallback = Some(tracing.version))
    } yield {
      desiredVersion match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  private def findPendingUpdates(tracingId: String,
                                 existingVersion: Long,
                                 desiredVersion: Long): Fox[List[SkeletonUpdateAction]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      for {
        updateActionGroups <- tracingDataStore.skeletonUpdates.getMultipleVersions(
          tracingId,
          Some(desiredVersion),
          Some(existingVersion + 1))(fromJson[List[SkeletonUpdateAction]])
      } yield {
        updateActionGroups.reverse.flatten
      }
    }

  private def update(tracing: SkeletonTracing,
                     tracingId: String,
                     updates: List[SkeletonUpdateAction],
                     newVersion: Long): Fox[SkeletonTracing] = {
    def updateIter(tracingFox: Fox[SkeletonTracing],
                   remainingUpdates: List[SkeletonUpdateAction]): Fox[SkeletonTracing] =
      tracingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(tracing) =>
          remainingUpdates match {
            case List() => Fox.successful(tracing)
            case RevertToVersionAction(sourceVersion, _, _) :: tail =>
              val sourceTracing = find(tracingId, Some(sourceVersion), useCache = false, applyUpdates = true)
              updateIter(sourceTracing, tail)
            case update :: tail => updateIter(Full(update.applyOn(tracing)), tail)
          }
        case _ => tracingFox
      }

    updates match {
      case List() => Full(tracing)
      case _ :: _ =>
        for {
          updated <- updateIter(Some(tracing), updates)
        } yield updated.withVersion(newVersion)
    }
  }

  def duplicate(tracing: SkeletonTracing, fromTask: Boolean): Fox[String] = {
    val taskBoundingBox = if (fromTask) {
      tracing.boundingBox.map { bb =>
        val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
        NamedBoundingBox(newId, Some("task bounding box"), Some(true), Some(getRandomColor), bb)
      }
    } else None

    val newTracing =
      tracing.withCreatedTimestamp(System.currentTimeMillis()).withVersion(0).addAllUserBoundingBoxes(taskBoundingBox)
    val finalTracing = if (fromTask) newTracing.clearBoundingBox else newTracing
    save(finalTracing, None, finalTracing.version)
  }

  def merge(tracings: Seq[SkeletonTracing]): SkeletonTracing =
    tracings
      .reduceLeft(mergeTwo)
      .copy(
        createdTimestamp = System.currentTimeMillis(),
        version = 0L,
      )

  private def mergeTwo(tracingA: SkeletonTracing, tracingB: SkeletonTracing): SkeletonTracing = {
    val nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
    val groupMapping = TreeUtils.calculateGroupMapping(tracingA.treeGroups, tracingB.treeGroups)
    val mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, nodeMapping, groupMapping)
    val mergedGroups = TreeUtils.mergeGroups(tracingA.treeGroups, tracingB.treeGroups, groupMapping)
    val mergedBoundingBox = combineBoundingBoxes(tracingA.boundingBox, tracingB.boundingBox)
    val userBoundingBoxes = combineUserBoundingBoxes(tracingA.userBoundingBox,
                                                     tracingB.userBoundingBox,
                                                     tracingA.userBoundingBoxes,
                                                     tracingB.userBoundingBoxes)

    tracingA.copy(
      trees = mergedTrees,
      treeGroups = mergedGroups,
      boundingBox = mergedBoundingBox,
      userBoundingBox = None,
      userBoundingBoxes = userBoundingBoxes
    )
  }

  // Can be removed again when https://github.com/scalableminds/webknossos/issues/5009 is fixed
  def remapTooLargeTreeIds(skeletonTracing: SkeletonTracing): SkeletonTracing = {
    if (skeletonTracing.trees.exists(_.treeId > 1048576) {

    } else skeletonTracing
  }

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[SkeletonTracing],
                      newId: String,
                      newTracing: SkeletonTracing,
                      toCache: Boolean): Fox[Unit] = Fox.successful(())

  def updateActionLog(tracingId: String): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[SkeletonUpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )
    for {
      updateActionGroups <- tracingDataStore.skeletonUpdates.getMultipleVersionsAsVersionValueTuple(tracingId)(
        fromJson[List[SkeletonUpdateAction]])
      updateActionGroupsJs = updateActionGroups.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  def updateActionStatistics(tracingId: String): Fox[JsObject] =
    for {
      updateActionGroups <- tracingDataStore.skeletonUpdates.getMultipleVersions(tracingId)(
        fromJson[List[SkeletonUpdateAction]])
      updateActions = updateActionGroups.flatten
    } yield {
      Json.obj(
        "updateTracingActionCount" -> updateActions.count {
          case _: UpdateTracingSkeletonAction => true
          case _                              => false
        },
        "createNodeActionCount" -> updateActions.count {
          case _: CreateNodeSkeletonAction => true
          case _                           => false
        },
        "deleteNodeActionCount" -> updateActions.count {
          case _: DeleteNodeSkeletonAction => true
          case _                           => false
        }
      )
    }
}
