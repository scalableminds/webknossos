package com.scalableminds.webknossos.datastore.services.segmentindex

trait SegmentIndexFileUtils {

  protected val keyHashBucketOffsets = "hash_bucket_offsets"
  protected val keyHashBuckets = "hash_buckets"
  protected val keyTopLefts = "top_lefts"

  protected val attrKeyHashFunction = "hash_function"
  protected val attrKeyNHashBuckets = "n_hash_buckets"
  protected val attrKeyDtypeBucketEntries = "dtype_bucket_entries"

}
