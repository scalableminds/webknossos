import Store from "oxalis/store";

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'key' implicitly has an 'any' type.
function prefixKey(key, isOrganizationSpecific) {
  const { activeUser } = Store.getState();
  let prefix;

  if (!activeUser) {
    prefix = "Anonymous";
  } else if (isOrganizationSpecific) {
    prefix = `${activeUser.email}-${activeUser.organization}`;
  } else {
    prefix = activeUser.email;
  }

  return `${prefix}-${key}`;
}

const UserLocalStorage = {
  getItem(key: string, isOrganizationSpecific: boolean = true): string | null {
    return localStorage.getItem(prefixKey(key, isOrganizationSpecific));
  },

  setItem(key: string, value: string, isOrganizationSpecific: boolean = true): void {
    const trySetItem = () => localStorage.setItem(prefixKey(key, isOrganizationSpecific), value);
    try {
      trySetItem();
    } catch (exception) {
      console.warn("localStorage.setItem failed. Clearing localStorage and retrying...", exception);
      localStorage.clear();
      trySetItem();
    }
  },

  removeItem(key: string, isOrganizationSpecific: boolean = true): void {
    localStorage.removeItem(prefixKey(key, isOrganizationSpecific));
  },

  clear(): void {
    localStorage.clear();
  },
};
export default UserLocalStorage;
