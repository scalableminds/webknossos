package com.scalableminds.webknossos.datastore.services.segmentindex

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox

import javax.inject.Inject

class ZarrSegmentIndexFileService @Inject()() {

  def readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey, segmentId: Long): Fox[Array[Vec3Int]] = ???

  def readFileMag(segmentIndexFileKey: SegmentIndexFileKey): Fox[Vec3Int] = ???
}
