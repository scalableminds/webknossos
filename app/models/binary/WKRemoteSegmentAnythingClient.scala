package models.binary

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import utils.WkConf

import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {
  def getEmbedding(imageData: Array[Byte]): Fox[Array[Byte]] =
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam_vit_l").getWithBytesResponse
}
