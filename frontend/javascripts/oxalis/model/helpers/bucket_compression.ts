import { createWorker } from "oxalis/workers/comlink_wrapper";
import compressLz4Block from "oxalis/workers/byte_array_lz4_compression.worker";
import type { BucketDataArray, ElementClass } from "types/api_flow_types";
import { uint8ToTypedBuffer } from "./typed_buffer";

const _byteArrayToLz4Array = createWorker(compressLz4Block);

export const decompressToTypedArray = async (
  compressedData: Uint8Array,
  elementClass: ElementClass,
): Promise<BucketDataArray> => {
  const decompressedBackendData = await _byteArrayToLz4Array(compressedData, false);
  return uint8ToTypedBuffer(decompressedBackendData, elementClass);
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
