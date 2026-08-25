import {
  getDataStoresCached,
  getTracingStoreCached,
  isInMaintenance as isInMaintenanceAPICall,
  pingHealthEndpoint,
} from "admin/rest_api";
import { registerPingFn } from "libs/handle_request_error_helper";
import Toast from "libs/toast";
import memoize from "lodash-es/memoize";
import throttle from "lodash-es/throttle";
import uniq from "lodash-es/uniq";
import messages from "messages";

// Create a throttled function which depends on its arguments.
// That way, each datastore is checked for health in a throttled and isolated manner
const memoizedThrottle = <F extends (...args: Array<any>) => any>(func: F, wait = 0): F => {
  // Memoize the creation of a throttling function
  const mem = memoize((..._args: any[]) => throttle(func, wait));

  return ((...args: Parameters<F>) => {
    // look up (or create) the throttling function and invoke it
    return mem(...args)(...args);
  }) as F;
};

// Do not call this function directly, but call pingMentionedDataStores instead
// which will take care of extracting the hostnames.
// Otherwise, the memoization will not work correctly if the path and query-string are part of the URL
const pingDataStoreIfAppropriate = memoizedThrottle(async (requestedUrl: string): Promise<any> => {
  const [datastores, tracingstore, isInMaintenance] = await Promise.all([
    getDataStoresCached(),
    getTracingStoreCached(),
    isInMaintenanceAPICall(),
  ]).catch(() => [null, null, null]);

  if (datastores == null || tracingstore == null || isInMaintenance == null) {
    Toast.warning(messages.offline);
    return;
  }

  const stores: Array<{ url: string; path: "tracings" | "data" }> = [
    { ...tracingstore, path: "tracings" },
    ...datastores.map((datastore) => ({ ...datastore, path: "data" as const })),
  ] as const;

  if (isInMaintenance) {
    Toast.warning(messages.planned_maintenance);
  } else {
    const usedStore = stores.find((ds) => requestedUrl.indexOf(ds.url) > -1);

    if (usedStore != null) {
      const { url, path } = usedStore;
      pingHealthEndpoint(url, path).catch(() =>
        Toast.warning(
          messages["datastore.health"]({
            url,
          }),
        ),
      );
    }
  }
}, 5000);

const extractUrls = (str: string): Array<string> => {
  const urlMatcher =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}(\.[a-z]{2,6})?\b([-a-zA-Z0-9@:%_+.~#?&\\=]*)/g;
  return uniq(str.match(urlMatcher) || []);
};

export const pingMentionedDataStores = (str: string): void => {
  extractUrls(str).map(pingDataStoreIfAppropriate);
};

registerPingFn(pingMentionedDataStores);
