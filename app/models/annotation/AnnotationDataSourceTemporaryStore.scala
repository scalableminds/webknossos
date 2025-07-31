package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.storage.TemporaryStore

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/**
  * Used to store a mapping from annotation id to datasource and datasetId. This makes it possible for WK to answer a
  * /tracingstores/:name/dataSource or /tracingstores/:name/datasetId request before an annotation is created.
  * This happens when uploading an annotation.
  * It also provides a mapping from temporary/compound annotation id (e.g. taskTypeId, projectId) to datasource.
  */
class AnnotationDataSourceTemporaryStore @Inject()(
    temporaryStore: TemporaryStore[ObjectId, (DataSourceLike, ObjectId)]) {

  private val timeOut = 7 * 24 hours

  def store(annotationId: ObjectId, dataSource: DataSourceLike, datasetId: ObjectId)(
      implicit ec: ExecutionContext): Unit =
    temporaryStore.insert(annotationId, (dataSource, datasetId), Some(timeOut))

  def find(annotationId: ObjectId): Option[(DataSourceLike, ObjectId)] =
    temporaryStore.get(annotationId)

}
