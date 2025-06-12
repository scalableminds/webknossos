import * as RestAPI from "admin/rest_api";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";
import type { APIBuildInfoDatastore, APIBuildInfoWk } from "types/api_types";

// Create a throttled function which depends on its arguments.
// That way, each datastore is checked for health in a throttled and isolated manner
const memoizedThrottle = <F extends (...args: Array<any>) => any>(func: F, wait = 0): F => {
  // Memoize the creation of a throttling function
  const mem = _.memoize((..._args: any[]) => _.throttle(func, wait));

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
    RestAPI.getDataStoresCached(),
    RestAPI.getTracingStoreCached(),
    RestAPI.isInMaintenance(),
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
      RestAPI.pingHealthEndpoint(url, path).then(
        () => {
          if (usedStore.path === "data") {
            checkVersionMismatchInDataStore(url);
          }
        },
        () =>
          Toast.warning(
            messages["datastore.health"]({
              url,
            }),
          ),
      );
    }
  }
}, 5000);

async function checkVersionMismatchInDataStore(datastoreUrl: string) {
  const [buildinfoWebknossos, buildinfoDatastore] = (await Promise.all([
    RestAPI.getBuildInfo(),
    RestAPI.getDataOrTracingStoreBuildInfo(datastoreUrl),
  ])) as [APIBuildInfoWk, APIBuildInfoDatastore];
  const expectedDatastoreApiVersion = buildinfoWebknossos.webknossos.datastoreApiVersion;
  const buildInfoWebknossosDatastore = buildinfoDatastore.webknossosDatastore;
  const suppliedDatastoreApiVersion = buildInfoWebknossosDatastore.datastoreApiVersion;

  if (
    Number(expectedDatastoreApiVersion.split(".")[0]) <
    Number(suppliedDatastoreApiVersion.split(".")[0])
  ) {
    Toast.warning(
      messages["datastore.version.too_new"]({
        expectedDatastoreApiVersion,
        suppliedDatastoreApiVersion,
        datastoreUrl,
      }),
    );
  } else if (
    Number(expectedDatastoreApiVersion.split(".")[0]) >
    Number(suppliedDatastoreApiVersion.split(".")[0])
  ) {
    Toast.warning(
      messages["datastore.version.too_old"]({
        expectedDatastoreApiVersion,
        suppliedDatastoreApiVersion,
        datastoreUrl,
      }),
    );
  }
}

const extractUrls = (str: string): Array<string> => {
  const urlMatcher =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}(\.[a-z]{2,6})?\b([-a-zA-Z0-9@:%_+.~#?&\\=]*)/g;
  return _.uniq(str.match(urlMatcher) || []);
};

export const pingMentionedDataStores = (str: string): void => {
  extractUrls(str).map(pingDataStoreIfAppropriate);
};
export default {};
