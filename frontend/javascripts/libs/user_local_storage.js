// @flow

import Store from "oxalis/store";

function prefixKey(key) {
  const { activeUser } = Store.getState();
  console.log("activeUser", activeUser);
  const prefix = !activeUser ? "Anonymous" : activeUser.email;
  return `${prefix}-${key}`;
}

const UserLocalStorage = {
  getItem(key: string): ?string {
    console.log("getting", key);
    return localStorage.getItem(prefixKey(key));
  },

  setItem(key: string, value: string): void {
    console.log("setting", key);
    return localStorage.setItem(prefixKey(key), value);
  },

  clear(): void {
    localStorage.clear();
  },

  removeItem(key: string): void {
    return localStorage.removeItem(key);
  },
};

export default UserLocalStorage;
