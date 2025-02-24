package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceLike
import com.scalableminds.webknossos.datastore.storage.TemporaryStore

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/**
  * Used to store a mapping from annotation id to datasource. This makes it possible for WK to answer a
  * /tracingstores/:name/dataSource request before an annotation is created. This happens when uploading an annotation.
  */
class TracingDataSourceTemporaryStore @Inject()(temporaryStore: TemporaryStore[ObjectId, DataSourceLike]) {

  private val timeOut = 7 * 24 hours

  def store(annotationId: ObjectId, dataSource: DataSourceLike)(implicit ec: ExecutionContext): Unit =
    temporaryStore.insert(annotationId, dataSource, Some(timeOut))

  def find(annotationId: ObjectId): Option[DataSourceLike] =
    temporaryStore.get(annotationId)

}
