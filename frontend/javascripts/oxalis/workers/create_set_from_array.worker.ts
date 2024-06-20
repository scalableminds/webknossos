import { BucketDataArray } from "oxalis/model/bucket_data_handling/bucket";
import { expose } from "./comlink_wrapper";

function createSetFromArray(data: BucketDataArray): Set<number> | Set<bigint> {
  // @ts-ignore The Set constructor accepts null and BigUint64Arrays just fine.
  return new Set(data);
}

export default expose(createSetFromArray);
