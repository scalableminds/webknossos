package models.dataset

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import slick.jdbc.PostgresProfile.api.*
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Unified datasets prototype: where the data of a linked data layer really lives. Only written for layers that were
// linked from another dataset (copies, added layers). Never threaded through the DataSource models.
case class DatasetLayerOrigin(
    _dataset: ObjectId,
    layerName: String,
    _sourceDataset: ObjectId,
    sourceLayerName: String
)

case class DatasetLayerOriginWithSourceName(origin: DatasetLayerOrigin, sourceDatasetName: Option[String])

class DatasetLayerOriginDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllForDataset(datasetId: ObjectId): Fox[Seq[DatasetLayerOrigin]] =
    for {
      rows <- run(q"""SELECT _dataset, layerName, _sourceDataset, sourceLayerName
                      FROM webknossos.dataset_layer_origins
                      WHERE _dataset = $datasetId""".as[(ObjectId, String, ObjectId, String)])
    } yield rows.map(DatasetLayerOrigin.apply.tupled)

  // The source name is None if the source dataset was deleted.
  def findAllWithSourceNamesForDataset(datasetId: ObjectId): Fox[Seq[DatasetLayerOriginWithSourceName]] =
    for {
      rows <- run(q"""SELECT o._dataset, o.layerName, o._sourceDataset, o.sourceLayerName, d.name
                      FROM webknossos.dataset_layer_origins o
                      LEFT JOIN webknossos.datasets_ d ON d._id = o._sourceDataset
                      WHERE o._dataset = $datasetId""".as[(ObjectId, String, ObjectId, String, Option[String])])
    } yield rows.map { case (datasetId, layerName, sourceDatasetId, sourceLayerName, sourceName) =>
      DatasetLayerOriginWithSourceName(
        DatasetLayerOrigin(datasetId, layerName, sourceDatasetId, sourceLayerName),
        sourceName
      )
    }

  def insertAll(origins: Seq[DatasetLayerOrigin]): Fox[Unit] =
    for {
      _ <- run(DBIO.sequence(origins.map { o =>
        q"""INSERT INTO webknossos.dataset_layer_origins(_dataset, layerName, _sourceDataset, sourceLayerName)
            VALUES(${o._dataset}, ${o.layerName}, ${o._sourceDataset}, ${o.sourceLayerName})
            ON CONFLICT (_dataset, layerName) DO UPDATE
            SET _sourceDataset = EXCLUDED._sourceDataset, sourceLayerName = EXCLUDED.sourceLayerName""".asUpdate
      }).transactionally)
    } yield ()

  def deleteOne(datasetId: ObjectId, layerName: String): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.dataset_layer_origins
                   WHERE _dataset = $datasetId AND layerName = $layerName""".asUpdate)
    } yield ()
}
