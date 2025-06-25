package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo

trait EditableMappingElementKeys {

  protected def agglomerateGraphKey(mappingId: String, agglomerateId: Long): String =
    s"$mappingId/$agglomerateId"

  protected def segmentToAgglomerateKey(mappingId: String, chunkId: Long): String =
    s"$mappingId/$chunkId"

  protected def chunkIdFromSegmentToAgglomerateKey(key: String): Box[Long] = tryo(key.split("/")(1).toLong)

  protected def agglomerateIdFromAgglomerateGraphKey(key: String): Box[Long] = tryo(key.split("/")(1).toLong)

}
