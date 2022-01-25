// @flow
import { type BucketDataArray, DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import compressLz4Block from "oxalis/workers/byte_array_lz4_compression.worker";

const _byteArrayToLz4Array = createWorker(compressLz4Block);

export const decompressToTypedArray = async (
  bucket: DataBucket,
  compressedData: Uint8Array,
): Promise<BucketDataArray> => {
  const decompressedBackendData = await _byteArrayToLz4Array(compressedData, false);
  return bucket.uint8ToTypedBuffer(decompressedBackendData);
};

export const compressTypedArray = async (bucketData: BucketDataArray): Promise<Uint8Array> => {
  const bucketDataAsByteArray = new Uint8Array(
    bucketData.buffer,
    bucketData.byteOffset,
    bucketData.byteLength,
  );
  const compressedBucketData = await _byteArrayToLz4Array(bucketDataAsByteArray, true);
  return compressedBucketData;
};
