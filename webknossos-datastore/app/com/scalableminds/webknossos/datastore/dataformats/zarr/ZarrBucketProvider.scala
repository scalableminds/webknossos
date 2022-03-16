package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.FileSystem

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.requestlogging.RateLimitedErrorLogging
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Empty}

class ZarrCube(zarrArray: ZarrArray) extends DataCube with LazyLogging with RateLimitedErrorLogging {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val shape = Vec3Int(bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)
    val offset = Vec3Int(bucket.globalX, bucket.globalY, bucket.globalZ)
    tryo(onError = e => logError(e))(zarrArray.readBytesXYZ(shape, offset))
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging with RateLimitedErrorLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val resolution: Option[ZarrMag] =
      layer.mags.find(_.mag == readInstruction.bucket.resolution)
    resolution.map { resolution =>
      resolution.remoteSource match {
        case Some(remoteSource) => loadRemote(remoteSource)
        case None               => loadLocal(readInstruction, resolution.pathWithFallback)
      }
    }.getOrElse(Empty)
  }

  private def loadRemote(remoteSource: RemoteSourceDescriptor): Box[ZarrCube] = {
    val layerPathOpt = FileSystemHolder.getOrCreate(remoteSource).map { fs: FileSystem =>
      fs.getPath(remoteSource.remotePath)
    }
    layerPathOpt match {
      case None => Empty
      case Some(layerPath) =>
        tryo(onError = e => logError(e))(ZarrArray.open(layerPath)).map(new ZarrCube(_))
    }
  }

  private def loadLocal(readInstruction: DataReadInstruction, resolutionPath: String): Box[ZarrCube] = {
    val layerPath = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
      .resolve(resolutionPath)
    if (layerPath.toFile.exists()) {
      tryo(onError = e => logError(e))(ZarrArray.open(layerPath)).map(new ZarrCube(_))
    } else Empty
  }

}
