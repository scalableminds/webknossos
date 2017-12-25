/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.skeleton
import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.binary.storage.kvstore.{KeyValueStoreImplicits, VersionedKeyValuePair}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import net.liftweb.common.{Empty, Full}
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.webknossos.datastore.tracings.UpdateAction.SkeletonUpdateAction
import com.scalableminds.webknossos.datastore.tracings.skeleton.updating._

class SkeletonTracingService @Inject()(
                                        tracingDataStore: TracingDataStore,
                                        val temporaryTracingStore: TemporaryTracingStore[SkeletonTracing]
                                      )
  extends TracingService[SkeletonTracing]
    with KeyValueStoreImplicits
    with ProtoGeometryImplicits
    with FoxImplicits
    with TextUtils {

  val tracingType = TracingType.skeleton

  val tracingStore = tracingDataStore.skeletons

  implicit val tracingCompanion = SkeletonTracing

  implicit val updateActionReads = SkeletonUpdateAction.skeletonUpdateActionFormat

  def currentVersion(tracingId: String): Fox[Long] = tracingDataStore.skeletonUpdates.getVersion(tracingId).getOrElse(0L)

  def handleUpdateGroup(tracingId: String, updateActionGroup: UpdateActionGroup[SkeletonTracing]): Fox[_] = {
    tracingDataStore.skeletonUpdates.put(tracingId, updateActionGroup.version, updateActionGroup.actions)
  }

  override def applyPendingUpdates(tracing: SkeletonTracing, tracingId: String, desiredVersion: Option[Long]): Fox[SkeletonTracing] = {
    val existingVersion = tracing.version
    findDesiredOrNewestPossibleVersion(tracing, tracingId, desiredVersion).flatMap { newVersion =>
      if (newVersion > existingVersion) {
        val pendingUpdates = findPendingUpdates(tracingId, existingVersion, newVersion)
        for {
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

  private def findDesiredOrNewestPossibleVersion(tracing: SkeletonTracing, tracingId: String, desiredVersion: Option[Long]): Fox[Long] = {
    (for {
      newestUpdateVersion <- tracingDataStore.skeletonUpdates.getVersion(tracingId)
    } yield {
      desiredVersion match {
        case None => newestUpdateVersion
        case Some(desiredSome) => math.min(desiredSome, newestUpdateVersion)
      }
    }).getOrElse(tracing.version) //if there are no updates at all, assume tracing was created from NML
  }

  private def findPendingUpdates(tracingId: String, existingVersion: Long, desiredVersion: Long): List[SkeletonUpdateAction] = {
    def toListIter(versionIterator: Iterator[VersionedKeyValuePair[List[SkeletonUpdateAction]]],
                   acc: List[List[SkeletonUpdateAction]]): List[List[SkeletonUpdateAction]] = {
      if (!versionIterator.hasNext) acc
      else {
        val item = versionIterator.next()
        if (item.version <= existingVersion) acc
        else toListIter(versionIterator, item.value :: acc)
      }
    }

    if (desiredVersion == existingVersion) List()
    else {
      val versionIterator = tracingDataStore.skeletonUpdates.scanVersions(tracingId, Some(desiredVersion))(fromJson[List[SkeletonUpdateAction]])
      toListIter(versionIterator, List()).flatten
    }
  }

  private def update(tracing: SkeletonTracing, tracingId: String, updates: List[SkeletonUpdateAction], newVersion: Long): Fox[SkeletonTracing] = {
    def updateIter(tracingFox: Fox[SkeletonTracing], remainingUpdates: List[SkeletonUpdateAction]): Fox[SkeletonTracing] = {
      tracingFox.futureBox.flatMap {
        case Empty => Fox.empty
        case Full(tracing) => {
          remainingUpdates match {
            case List() => Fox.successful(tracing)
            case RevertToVersionAction(sourceVersion) :: tail => {
              val sourceTracing = find(tracingId, Some(sourceVersion), useCache = false, applyUpdates = true)
              updateIter(sourceTracing, tail)
            }
            case update :: tail => updateIter(Full(update.applyOn(tracing)), tail)
          }
        }
        case _ => tracingFox
      }
    }

    updates match {
      case List() => Full(tracing)
      case head :: tail => {
        for {
          updated <- updateIter(Some(tracing), updates)
        } yield updated.withVersion(newVersion)
      }
    }
  }

  def duplicate(tracing: SkeletonTracing): Fox[String] = {
    val newTracing = tracing.withCreatedTimestamp(System.currentTimeMillis()).withVersion(0)
    save(newTracing, None, newTracing.version)
  }

  private def mergeTwo(tracingA: SkeletonTracing, tracingB: SkeletonTracing) = {
    val nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
    val mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, nodeMapping)
    val mergedBoundingBox = for {
      boundinBoxA <- tracingA.boundingBox
      boundinBoxB <- tracingB.boundingBox
    } yield {
      BoundingBox.combine(List[BoundingBox](boundinBoxA, boundinBoxB))
    }

    tracingA.copy(trees = mergedTrees, boundingBox = mergedBoundingBox, version = 0, userBoundingBox = None)
  }

  def merge(tracings: Seq[SkeletonTracing]): SkeletonTracing = tracings.reduceLeft(mergeTwo)
}
