package com.scalableminds.webknossos.datastore.services

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.util.concurrent.ConcurrentHashMap

import akka.util.ByteString
import com.google.inject.Inject

import scala.concurrent.ExecutionContext.Implicits.global
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.rpc.RPC
import net.liftweb.common.Full
import play.api.libs.json.Json

class SampleDataSourceService @Inject()(
                                    rpc: RPC,
                                    dataSourceService: DataSourceService,
                                    webknossosServer: DataStoreWkRpcClient,
                                    dataSourceRepository: DataSourceRepository)
  extends FoxImplicits {

  val availableDatasets = Map(
    "Sample_Cremi_dsA_plus" -> "http://localhost/cremi.zip",
    "Sample_Cremi_dsA_plus2" -> "http://localhost/cremi.zip")

  var runningDownloads = new ConcurrentHashMap[DataSourceId, Unit]()

  def initDownload(organizationName: String, dataSetName: String): Fox[Unit] = {
    val dataSourceId = DataSourceId(dataSetName, organizationName)
    for {
      _ <- bool2Fox(availableDatasets.contains(dataSetName)) ?~> "dataSet.name.notInSamples"
      _ <- bool2Fox(!runningDownloads.contains(dataSourceId)) ?~> "dataSet.downloadAlreadyRunning"
      _ <- bool2Fox(dataSourceRepository.find(dataSourceId).isEmpty) ?~> "dataSet.alreadyPresent"
      _ <- webknossosServer.validateDataSourceUpload(dataSourceId) ?~> "dataSet.name.alreadyTaken"
      _ = runningDownloads.put(dataSourceId, ())
      _ = download(dataSourceId)
    } yield ()
  }

  def download(id: DataSourceId): Fox[Unit] = {
    for {
      responseBox <- rpc(availableDatasets(id.name)).get.futureBox
      _ = responseBox match {
          case Full(response) => {
              val bytes: ByteString = response.bodyAsBytes
              val tmpfile = File.createTempFile("demodataset", "zip")
              val stream = new BufferedOutputStream(new FileOutputStream(tmpfile))
              stream.write(bytes.toArray)
              stream.close()
              dataSourceService.handleUpload(id, tmpfile)
                .map {_ =>
                  runningDownloads.remove(id)
                }
            }
          case _ => runningDownloads.remove(id)
        }
    } yield ()
  }

  case class SampleDataSourceWithStatus(name: String, status: String)
  object SampleDataSourceWithStatus { implicit val format = Json.format[SampleDataSourceWithStatus] }

  def listWithStatus(organizationName: String): List[SampleDataSourceWithStatus] = {
    availableDatasets.keys.toList.map(dataSetName => SampleDataSourceWithStatus(dataSetName, statusFor(DataSourceId(dataSetName, organizationName))))
  }

  def statusFor(id: DataSourceId): String = {
    if (runningDownloads.containsKey(id)) "downloading"
    else if (dataSourceRepository.find(id).isDefined) "present"
    else "available"
  }

}
