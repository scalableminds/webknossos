package models.binary

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import utils.WkConf

import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {
  def getEmbedding(imageData: Array[Byte], elementClass: ElementClass.Value): Fox[Array[Byte]] =
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam_vit_l")
      .addQueryString("elementClass" -> elementClass.toString)
      .postBytesWithBytesResponse(imageData)
}
