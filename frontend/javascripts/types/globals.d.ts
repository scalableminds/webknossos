import { ApiType } from "viewer/api/api_loader"
import WkDev from "viewer/api/wk_dev";

declare global {
  interface Window {
    needsRerender: boolean;
    webknossos: {
      DEV: WkDev;
      apiReady: ApiType["apiReady"]
    };
  }

  // This is a helper interface that can be implemented by custom collections
  // to ensure that Object.{keys,values,entries} is not used on them (as TS
  // will happily allow this while being most likely not what was intended).
  interface NotEnumerableByObject {
    __notEnumerableByObject: true;
  }

  interface ObjectConstructor {
    keys<T extends NotEnumerableByObject>(obj: T): never;
    values<T extends NotEnumerableByObject>(obj: T): never;
    entries<T extends NotEnumerableByObject>(obj: T): never;
  }

}


