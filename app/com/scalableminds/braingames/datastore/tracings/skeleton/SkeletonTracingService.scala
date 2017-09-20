/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton

import com.google.inject.Inject
import com.scalableminds.braingames.binary.storage.kvstore.{KeyValueStoreImplicits, VersionedKeyValuePair}
import com.scalableminds.braingames.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import net.liftweb.common.{Empty, Full}
import play.api.libs.concurrent.Execution.Implicits._

import scala.reflect._


class SkeletonTracingService @Inject()(
                                        tracingDataStore: TracingDataStore,
                                        val temporaryTracingStore: TemporaryTracingStore[SkeletonTracing]
                                      ) extends TracingService[SkeletonTracing] with KeyValueStoreImplicits with FoxImplicits with TextUtils {

  val tracingType = TracingType.skeleton

  val tracingStore = tracingDataStore.skeletons

  implicit val tracingCompanion = SkeletonTracing

  def saveUpdates(tracingId: String, updateActionGroups: List[SkeletonUpdateActionGroup]): Fox[List[_]] = {
    Fox.combined(for {
      updateActionGroup <- updateActionGroups
    } yield {
      tracingDataStore.skeletonUpdates.put(tracingId, updateActionGroup.version, updateActionGroup.actions)
    })
  }

  override def applyPendingUpdates(tracing: SkeletonTracing, tracingId: String, desiredVersion: Option[Long]): Fox[SkeletonTracing] = {
    val existingVersion = tracing.version
    findDesiredOrNewestPossibleVersion(tracing, tracingId, desiredVersion).flatMap { newVersion =>
      if (newVersion > existingVersion) {
        val pendingUpdates = findPendingUpdates(tracingId, existingVersion, newVersion)
        for {
          updatedTracing <- update(tracing, tracingId, pendingUpdates, newVersion)
        } yield {
          save(updatedTracing, tracingId, newVersion)
          updatedTracing
        }
      } else {
        Full(tracing)
      }
    }
  }

  private def findDesiredOrNewestPossibleVersion(tracing: SkeletonTracing, tracingId: String, desiredVersion: Option[Long]): Fox[Long] = {
    (for {
      newestUpdate <- tracingDataStore.skeletonUpdates.get(tracingId)
    } yield {
      desiredVersion match {
        case None => newestUpdate.version
        case Some(desiredSome) => math.min(desiredSome, newestUpdate.version)
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
    val newTracingId = createNewId
    for {
      _ <- save(newTracing, createNewId, newTracing.version)
    } yield newTracingId
  }

  private def mergeTwo(tracingA: SkeletonTracing, tracingB: SkeletonTracing) = {
    val nodeMapping = TreeUtils.calculateNodeMapping(tracingA.trees, tracingB.trees)
    val mergedTrees = TreeUtils.mergeTrees(tracingA.trees, tracingB.trees, nodeMapping)
    val mergedBoundingBox = BoundingBoxUtils.mergeTwoOpt(tracingA.boundingBox, tracingB.boundingBox)
    tracingA.copy(trees = mergedTrees, boundingBox = mergedBoundingBox, version = 0)
  }

  def merge(tracings: Seq[SkeletonTracing], newId: String = createNewId): SkeletonTracing =
    tracings.reduceLeft(mergeTwo)


}
