package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.nio.file.FileSystem

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.FileSystemHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Full}

class ZarrCube(zarrArray: ZarrArray) extends DataCube with LazyLogging {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val shape = Vec3Int(bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)
    val offset = Vec3Int(bucket.globalX, bucket.globalY, bucket.globalZ)
    Full(zarrArray.readBytesXYZ(shape, offset))
  }

  override protected def onFinalize(): Unit = ()

}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val resolution: Option[ZarrResolution] = layer.resolutions.find(_.resolution == readInstruction.bucket.resolution)
    resolution.map { resolution =>
      val layerPathOpt = FileSystemHolder.getOrCreate(remoteSource).map { fs: FileSystem =>
        fs.getPath(layer.remotePath.getOrElse(""))
      }
      layerPathOpt match {
        case None => Empty
        case Some(layerPath) =>
          logger.info(s"opening: $layerPath")
          Full(ZarrArray.open(layerPath)).map(new ZarrCube(_))
      }
    }.getOrElse {
      val layerPath = readInstruction.baseDir
        .resolve(readInstruction.dataSource.id.team)
        .resolve(readInstruction.dataSource.id.name)
        .resolve(readInstruction.dataLayer.name)
      logger.info(s"Opening local: ${layerPath}")
      if (layerPath.toFile.exists()) {
        Full(ZarrArray.open(layerPath)).map(new ZarrCube(_))
      } else Empty
    }
  }

}
