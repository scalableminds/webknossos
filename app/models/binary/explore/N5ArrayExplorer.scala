package models.binary.explore
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.n5.N5Layer
import com.scalableminds.webknossos.datastore.dataformats.zarr.FileSystemCredentials

import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits.global

class N5ArrayExplorer extends RemoteLayerExplorer {

  override def name: String = "N5 Array"

  override def explore(remotePath: Path, credentials: Option[FileSystemCredentials]): Fox[List[(N5Layer, Vec3Double)]] =
    Fox.successful(List.empty)

}
