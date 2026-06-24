package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.tools.Box.tryo

import scala.concurrent.ExecutionContext

trait MissingBucketHeaders extends FoxImplicits {

  protected lazy val failureBucketIndicesHeader: String = "Failure-Bucket-Indices"
  protected lazy val emptyBucketIndicesHeader: String = "Empty-Bucket-Indices"
  protected lazy val legacyMissingBucketsHeader: String = "MISSING-BUCKETS"

  protected def createMissingBucketsHeaders(
      emptyBucketIndices: Seq[Int],
      failureBucketIndices: Seq[Int]
  ): Seq[(String, String)] =
    Seq(
      emptyBucketIndicesHeader -> formatIndices(emptyBucketIndices),
      failureBucketIndicesHeader -> formatIndices(failureBucketIndices),
      // Kept for the moment in order not to break existing sessions. Remove after 2026-09.
      legacyMissingBucketsHeader -> formatIndices((emptyBucketIndices ++ failureBucketIndices).sorted),
      "Access-Control-Expose-Headers" -> s"$failureBucketIndicesHeader, $emptyBucketIndicesHeader, $legacyMissingBucketsHeader"
    )

  private def formatIndices(indices: Seq[Int]): String =
    "[" + indices.mkString(", ") + "]"

  protected def parseMissingBucketHeader(
      headerLiteralOpt: Option[String]
  )(implicit ec: ExecutionContext): Fox[Seq[Int]] =
    for {
      headerLiteral: String <- headerLiteralOpt.toFox
      headerLiteralTrim = headerLiteral.trim
      _ <- Fox.fromBool(headerLiteralTrim.startsWith("[") && headerLiteralTrim.endsWith("]"))
      indicesStr = headerLiteralTrim.drop(1).dropRight(1).split(",").toList.filter(_.nonEmpty)
      indices <- Fox.serialCombined(indicesStr)(indexStr => tryo(indexStr.trim.toInt).toFox)
    } yield indices

}
