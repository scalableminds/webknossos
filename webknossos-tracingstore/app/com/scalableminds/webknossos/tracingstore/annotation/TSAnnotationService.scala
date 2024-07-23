package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationLayerProto, AnnotationProto}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayerType
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{
  CreateNodeSkeletonAction,
  DeleteNodeSkeletonAction,
  UpdateTracingSkeletonAction
}
import com.scalableminds.webknossos.tracingstore.tracings.volume.UpdateBucketVolumeAction
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingUpdatesReport}
import net.liftweb.common.{Empty, Full}
import play.api.libs.json.{JsObject, JsValue, Json}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSAnnotationService @Inject()(remoteWebknossosClient: TSRemoteWebknossosClient,
                                    tracingDataStore: TracingDataStore)
    extends KeyValueStoreImplicits {

  def reportUpdates(annotationId: String, updateGroups: List[UpdateActionGroup], userToken: Option[String]): Fox[Unit] =
    for {
      _ <- remoteWebknossosClient.reportTracingUpdates(
        TracingUpdatesReport(
          annotationId,
          timestamps = updateGroups.map(g => Instant(g.timestamp)),
          statistics = updateGroups.flatMap(_.stats).lastOption,
          significantChangesCount = updateGroups.map(_.significantChangesCount).sum,
          viewChangesCount = updateGroups.map(_.viewChangesCount).sum,
          userToken
        ))
    } yield ()

  def currentVersion(annotationId: String): Fox[Long] = ???

  def handleUpdateGroup(annotationId: String,
                        updateActionGroup: UpdateActionGroup,
                        previousVersion: Long,
                        userToken: Option[String]): Fox[Unit] =
    // TODO apply some updates directly? transform to compact?
    tracingDataStore.annotationUpdates.put(annotationId,
                                           updateActionGroup.version,
                                           preprocessActionsForStorage(updateActionGroup))

  private def preprocessActionsForStorage(updateActionGroup: UpdateActionGroup): List[UpdateAction] = {
    val actionsWithInfo = updateActionGroup.actions.map(
      _.addTimestamp(updateActionGroup.timestamp).addAuthorId(updateActionGroup.authorId)) match {
      case Nil => List[UpdateAction]()
      //to the first action in the group, attach the group's info
      case first :: rest => first.addInfo(updateActionGroup.info) :: rest
    }
    actionsWithInfo.map {
      case a: UpdateBucketVolumeAction => a.transformToCompact // TODO or not?
      case a                           => a
    }
  }

  private def findPendingUpdates(annotationId: String, existingVersion: Long, desiredVersion: Long)(
      implicit ec: ExecutionContext): Fox[List[UpdateAction]] =
    if (desiredVersion == existingVersion) Fox.successful(List())
    else {
      for {
        updateActionGroups <- tracingDataStore.annotationUpdates.getMultipleVersions(
          annotationId,
          Some(desiredVersion),
          Some(existingVersion + 1))(fromJsonBytes[List[UpdateAction]])
      } yield updateActionGroups.reverse.flatten
    }

  def applyUpdate(annotation: AnnotationProto, updateAction: UpdateAction)(
      implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {
      updated <- updateAction match {
        case a: AddLayerAnnotationUpdateAction =>
          Fox.successful(
            annotation.copy(
              layers = annotation.layers :+ AnnotationLayerProto(a.tracingId,
                                                                 a.layerName,
                                                                 `type` = AnnotationLayerType.toProto(a.`type`))))
        case a: DeleteLayerAnnotationUpdateAction =>
          Fox.successful(annotation.copy(layers = annotation.layers.filter(_.tracingId != a.tracingId)))
        case a: UpdateLayerMetadataAnnotationUpdateAction =>
          Fox.successful(annotation.copy(layers = annotation.layers.map(l =>
            if (l.tracingId == a.tracingId) l.copy(name = a.layerName) else l)))
        case a: UpdateMetadataAnnotationUpdateAction =>
          Fox.successful(annotation.copy(name = a.name, description = a.description))
        case _ => Fox.failure("Received unsupported AnnotationUpdateAction action")
      }
    } yield updated.copy(version = updated.version + 1L)

  def updateActionLog(annotationId: String, newestVersion: Option[Long], oldestVersion: Option[Long]): Fox[JsValue] = {
    def versionedTupleToJson(tuple: (Long, List[UpdateAction])): JsObject =
      Json.obj(
        "version" -> tuple._1,
        "value" -> Json.toJson(tuple._2)
      )

    for {
      updateActionGroups <- tracingDataStore.annotationUpdates.getMultipleVersionsAsVersionValueTuple(
        annotationId,
        newestVersion,
        oldestVersion)(fromJsonBytes[List[UpdateAction]])
      updateActionGroupsJs = updateActionGroups.map(versionedTupleToJson)
    } yield Json.toJson(updateActionGroupsJs)
  }

  def get(annotationId: String, version: Option[Long], applyUpdates: Boolean, userToken: Option[String])(
      implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {
      annotationWithVersion <- tracingDataStore.annotations.get(annotationId, version)(fromProtoBytes[AnnotationProto])
      annotation = annotationWithVersion.value
      updated <- if (applyUpdates) applyPendingUpdates(annotation, annotationId, version, userToken)
      else Fox.successful(annotation)
    } yield updated

  private def applyPendingUpdates(annotation: AnnotationProto,
                                  annotationId: String,
                                  targetVersionOpt: Option[Long],
                                  userToken: Option[String])(implicit ec: ExecutionContext): Fox[AnnotationProto] =
    for {
      targetVersion <- determineTargetVersion(annotation, annotationId, targetVersionOpt)
      updates <- findPendingUpdates(annotationId, annotation.version, targetVersion)
      updated <- applyUpdates(annotation, annotationId, updates, targetVersion, userToken)
    } yield updated

  private def applyUpdates(annotation: AnnotationProto,
                           annotationId: String,
                           updates: List[UpdateAction],
                           targetVersion: Long,
                           userToken: Option[String])(implicit ec: ExecutionContext): Fox[AnnotationProto] = {

    def updateIter(tracingFox: Fox[AnnotationProto], remainingUpdates: List[UpdateAction]): Fox[AnnotationProto] =
      tracingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(annotation) =>
          remainingUpdates match {
            case List() => Fox.successful(annotation)
            case RevertToVersionUpdateAction(sourceVersion, _, _, _) :: tail =>
              val sourceTracing = get(annotationId, Some(sourceVersion), applyUpdates = true, userToken)
              updateIter(sourceTracing, tail)
            case update :: tail => updateIter(applyUpdate(annotation, update), tail)
          }
        case _ => tracingFox
      }

    if (updates.isEmpty) Full(annotation)
    else {
      for {
        updated <- updateIter(Some(annotation), updates)
      } yield updated.withVersion(targetVersion)
    }
  }

  private def determineTargetVersion(annotation: AnnotationProto,
                                     annotationId: String,
                                     targetVersionOpt: Option[Long]): Fox[Long] =
    /*
     * Determines the newest saved version from the updates column.
     * if there are no updates at all, assume annotation is brand new (possibly created from NML,
     * hence the emptyFallbck annotation.version)
     */
    for {
      newestUpdateVersion <- tracingDataStore.annotationUpdates.getVersion(annotationId,
                                                                           mayBeEmpty = Some(true),
                                                                           emptyFallback = Some(annotation.version))
    } yield {
      targetVersionOpt match {
        case None              => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }

  def updateActionStatistics(tracingId: String): Fox[JsObject] =
    for {
      updateActionGroups <- tracingDataStore.skeletonUpdates.getMultipleVersions(tracingId)(
        fromJsonBytes[List[UpdateAction]])
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
