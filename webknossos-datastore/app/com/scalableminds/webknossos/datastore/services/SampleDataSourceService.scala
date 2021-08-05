package com.scalableminds.webknossos.datastore.services

import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap

import akka.util.ByteString
import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.rpc.RPC
import net.liftweb.common.Full
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext.Implicits.global

case class SampleDatasetInfo(url: String, description: String)

class SampleDataSourceService @Inject()(rpc: RPC,
                                        uploadService: UploadService,
                                        remoteWebKnossosClient: DSRemoteWebKnossosClient,
                                        dataSourceRepository: DataSourceRepository)
    extends FoxImplicits {

  val availableDatasets =
    Map(
      "Sample_e2006_wkw" -> SampleDatasetInfo(
        "https://static.webknossos.org/data/e2006_wkw.zip",
        """Raw SBEM data and segmentation (sample cutout, 120MB)
          |Connectomic reconstruction of the inner plexiform layer in the mouse retina
          |M Helmstaedter, KL Briggman, S Turaga, V Jain, HS Seung, W Denk.
          |Nature. 08 August 2013. https://doi.org/10.1038/nature12346""".stripMargin
      ),
      "Sample_FD0144_wkw" -> SampleDatasetInfo(
        "https://static.webknossos.org/data/FD0144_wkw.zip",
        """Raw SBEM data and segmentation (sample cutout, 316 MB)
          |FluoEM, virtual labeling of axons in three-dimensional electron microscopy data for long-range connectomics
          |F Drawitsch, A Karimi, KM Boergens, M Helmstaedter.
          |eLife. 14 August 2018. https://doi.org/10.7554/eLife.38976""".stripMargin
      ),
      "Sample_MPRAGE_250um" -> SampleDatasetInfo(
        "https://static.webknossos.org/data/MPRAGE_250um.zip",
        """MRI data (250 MB)
          |T1-weighted in vivo human whole brain MRI dataset with an ultrahigh isotropic resolution of 250 μm
          |F Lüsebrink, A Sciarra, H Mattern, R Yakupov, O Speck
          |Scientific Data. 14 March 2017. https://doi.org/10.1038/sdata.2017.32""".stripMargin
      )
    )

  var runningDownloads = new ConcurrentHashMap[DataSourceId, Unit]()

  def initDownload(organizationName: String, dataSetName: String): Fox[Unit] = {
    val dataSourceId = DataSourceId(dataSetName, organizationName)
    for {
      _ <- bool2Fox(availableDatasets.contains(dataSetName)) ?~> "dataSet.name.notInSamples"
      _ <- bool2Fox(!runningDownloads.contains(dataSourceId)) ?~> "dataSet.downloadAlreadyRunning"
      _ <- bool2Fox(dataSourceRepository.find(dataSourceId).isEmpty) ?~> "dataSet.alreadyPresent"
      _ <- remoteWebKnossosClient.validateDataSourceUpload(dataSourceId) ?~> "dataSet.name.alreadyTaken"
      _ = runningDownloads.put(dataSourceId, ())
      _ = download(dataSourceId)
    } yield ()
  }

  def download(id: DataSourceId): Fox[Unit] =
    for {
      responseBox <- rpc(availableDatasets(id.name).url).get.futureBox
      _ = responseBox match {
        case Full(response) =>
          val bytes: ByteString = response.bodyAsBytes
          val downloadId = s"sampleDataset-${System.currentTimeMillis()}-${id.name}"
          val downloadDir = uploadService.uploadDirectory(id.team, downloadId)
          PathUtils.ensureDirectory(downloadDir)
          val tmpfile = new RandomAccessFile(downloadDir.resolve("dataset.zip").toFile, "rw")
          tmpfile.write(bytes.toArray)
          tmpfile.close()

          uploadService
            .finishUpload(UploadInformation(downloadId, id.team, id.name, List.empty, needsConversion = None),
                          checkCompletion = false)
            .map { _ =>
              runningDownloads.remove(id)
            }
        case _ => runningDownloads.remove(id)
      }
    } yield ()

  case class SampleDataSourceWithStatus(name: String, status: String, description: String)
  object SampleDataSourceWithStatus {
    implicit val format: OFormat[SampleDataSourceWithStatus] = Json.format[SampleDataSourceWithStatus]
  }

  def listWithStatus(organizationName: String): List[SampleDataSourceWithStatus] =
    availableDatasets.keys.toList.map(
      dataSetName =>
        SampleDataSourceWithStatus(dataSetName,
                                   statusFor(DataSourceId(dataSetName, organizationName)),
                                   availableDatasets(dataSetName).description))

  def statusFor(id: DataSourceId): String =
    if (runningDownloads.containsKey(id)) "downloading"
    else if (dataSourceRepository.find(id).isDefined) "present"
    else "available"

}
