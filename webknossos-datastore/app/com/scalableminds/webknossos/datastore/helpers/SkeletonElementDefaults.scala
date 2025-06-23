package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Node, SkeletonTracing, SkeletonUserStateProto}

object SkeletonTracingDefaults extends ProtoGeometryImplicits {
  private val datasetName = ""
  private val trees = Seq()
  private def createdTimestamp = System.currentTimeMillis()
  private val boundingBox = None
  private val activeNodeId = None
  val editPosition: Vec3Int = Vec3Int.zeros
  val editRotation: Vec3Double = Vec3Double.zeros
  val zoomLevel: Double = 2.0
  private val version = 0
  private val userBoundingBox = None

  def createInstance: SkeletonTracing =
    SkeletonTracing(datasetName,
                    trees,
                    createdTimestamp,
                    boundingBox,
                    activeNodeId,
                    editPosition,
                    editRotation,
                    zoomLevel,
                    version,
                    userBoundingBox)

  def emptyUserState(userId: ObjectId): SkeletonUserStateProto =
    SkeletonUserStateProto(
      userId = userId.toString,
      activeNodeId = None,
      treeGroupExpandedStates = Seq.empty,
      boundingBoxVisibilities = Seq.empty,
      treeVisibilities = Seq.empty
    )
}

object NodeDefaults extends ProtoGeometryImplicits {
  val id: Int = 0
  val rotation: Vec3Double = Vec3Double.zeros
  val position: Vec3Int = Vec3Int.zeros
  val radius: Float = 1.0f
  val viewport: Int = 1
  val mag: Int = 1
  val bitDepth: Int = 0
  val interpolation: Boolean = false
  def createdTimestamp: Long = System.currentTimeMillis()

  def createInstance: Node =
    Node(id, position, rotation, radius, viewport, mag, bitDepth, interpolation, createdTimestamp)
}
