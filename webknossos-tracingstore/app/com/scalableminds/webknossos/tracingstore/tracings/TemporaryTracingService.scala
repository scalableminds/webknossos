package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import scalapb.GeneratedMessageCompanion

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

// This services holds temporary stores, meant for temporary tracings only (e.g. compound projects)
// They cannot be used for download or updating/versioning
class TemporaryTracingService @Inject()(skeletonStore: TemporaryTracingStore[SkeletonTracing],
                                        volumeStore: TemporaryTracingStore[VolumeTracing],
                                        volumeDataStore: TemporaryTracingStore[Array[Byte]],
                                        annotationStore: TemporaryTracingStore[AnnotationProto],
                                        segmentIndexStore: TemporaryTracingStore[Set[Vec3IntProto]],
                                        temporaryTracingIdStore: TracingStoreRedisStore)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  implicit def skeletonTracingCompanion: GeneratedMessageCompanion[SkeletonTracing] = SkeletonTracing
  implicit def volumeTracingCompanion: GeneratedMessageCompanion[VolumeTracing] = VolumeTracing
  implicit def annotationProtoCompanion: GeneratedMessageCompanion[AnnotationProto] = AnnotationProto

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 70 minutes

  // the information that a tracing is/was temporary needs to be stored longer
  // to provide useful error messages to the user if the temporary tracing is no longer present
  private val temporaryIdStoreTimeout = 10 days

  private def temporaryTracingIdKey(tracingId: String) =
    s"temporaryTracingId___$tracingId"

  private def temporaryAnnotationIdKey(annotationId: ObjectId) =
    s"temporaryAnnotationId___$annotationId"

  def getAnnotation(annotationId: ObjectId): Fox[AnnotationProto] = annotationStore.get(annotationId.toString).toFox

  def getVolume(tracingId: String): Fox[VolumeTracing] = volumeStore.get(tracingId).toFox

  def getSkeleton(tracingId: String): Fox[SkeletonTracing] = skeletonStore.get(tracingId).toFox

  def getVolumeBucket(bucketKey: String): Fox[Array[Byte]] =
    volumeDataStore.get(bucketKey).toFox

  def getVolumeBuckets(bucketKeys: Seq[String]): Seq[Option[Array[Byte]]] =
    volumeDataStore.getMultiple(bucketKeys)

  def getAllVolumeBucketsWithPrefix(bucketPrefix: String): collection.Map[String, Array[Byte]] =
    volumeDataStore.getAllConditionalWithKey(key => key.startsWith(bucketPrefix))

  def getVolumeSegmentIndexBufferForKey(segmentIndexKey: String): Option[Set[Vec3IntProto]] =
    segmentIndexStore.get(segmentIndexKey)

  def saveSkeleton(tracingId: String, skeletonTracing: SkeletonTracing): Fox[Unit] = {
    skeletonStore.insert(tracingId, skeletonTracing, Some(temporaryStoreTimeout))
    registerTracingId(tracingId)
    Fox.successful(())
  }

  def saveVolume(tracingId: String, volumeTracing: VolumeTracing): Fox[Unit] = {
    volumeStore.insert(tracingId, volumeTracing, Some(temporaryStoreTimeout))
    registerTracingId(tracingId)
    Fox.successful(())
  }

  def saveVolumeBucket(bucketKey: String, bucketData: Array[Byte]): Fox[Unit] = {
    volumeDataStore.insert(bucketKey, bucketData, Some(temporaryStoreTimeout))
    Fox.successful(())
  }

  def saveVolumeBuckets(bucketDataByKey: Seq[(String, Array[Byte])]): Fox[Unit] = {
    volumeDataStore.insertAll(bucketDataByKey, Some(temporaryStoreTimeout))
    Fox.successful(())
  }

  def saveAnnotationProto(annotationId: ObjectId, annotationProto: AnnotationProto): Fox[Unit] = {
    annotationStore.insert(annotationId.toString, annotationProto, Some(temporaryStoreTimeout))
    registerAnnotationId(annotationId)
    Fox.successful(())
  }

  def saveVolumeSegmentIndexBuffer(tracingId: String,
                                   bucketPositionsBySegmentId: Seq[(String, Set[Vec3IntProto])]): Fox[Unit] = {
    segmentIndexStore.insertAll(bucketPositionsBySegmentId, Some(temporaryStoreTimeout))
    registerTracingId(tracingId)
    Fox.successful(())
  }

  def isTemporaryAnnotation(annotationId: ObjectId): Fox[Boolean] =
    temporaryTracingIdStore.contains(temporaryAnnotationIdKey(annotationId))

  def isTemporaryTracing(tracingId: String): Fox[Boolean] =
    temporaryTracingIdStore.contains(temporaryTracingIdKey(tracingId))

  def assertTracingStillPresent(tracingId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(volumeStore.contains(tracingId)) ?~> "Temporary Volume Tracing expired"
    } yield ()

  private def registerTracingId(tracingId: String) =
    temporaryTracingIdStore.insertKey(temporaryTracingIdKey(tracingId), Some(temporaryIdStoreTimeout))

  private def registerAnnotationId(annotationId: ObjectId) =
    temporaryTracingIdStore.insertKey(temporaryAnnotationIdKey(annotationId), Some(temporaryIdStoreTimeout))

}
