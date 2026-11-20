package backend

import com.scalableminds.util.box.Full
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.uploading.DatasetUploadMetadataStore
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import org.scalatest.wordspec.AsyncWordSpec
import play.api.Configuration
import play.api.inject.DefaultApplicationLifecycle

import scala.collection.concurrent.TrieMap
import scala.concurrent.duration.FiniteDuration

class DatasetUploadMetadataStoreTestSuite extends AsyncWordSpec {

  // Replaces the Redis-backed get/set with an in-memory map, so no Redis connection is needed.
  private class InMemoryRedisStore
      extends DataStoreRedisStore(
        new DataStoreConfig(Configuration.load(play.api.Environment.simple())),
        new DefaultApplicationLifecycle()
      )(using executionContext) {
    private val values = TrieMap.empty[String, String]

    override def find(id: String): Fox[String] = values.get(id) match {
      case Some(value) => Fox.successful(value)
      case None        => Fox.empty
    }

    override def insert(id: String, value: String, expiryOpt: Option[FiniteDuration] = None): Fox[Unit] = {
      values.put(id, value)
      Fox.successful(())
    }
  }

  "DatasetUploadMetadataStore" should {
    "return the identical upload id that was stored for a data source id" in {
      val metadataStore = new DatasetUploadMetadataStore(new InMemoryRedisStore)
      val dataSourceId = DataSourceId("l4_sample", "sample_organization")
      val uploadId = "2026-10-15_13-33__l4_sample__55d3cfab0f03"
      for {
        _ <- metadataStore.insertUploadIdByDataSourceId(dataSourceId, uploadId).futureBox
        foundUploadIdBox <- metadataStore.findUploadIdByDataSourceId(dataSourceId).futureBox
      } yield assert(foundUploadIdBox == Full(uploadId))
    }
  }
}
