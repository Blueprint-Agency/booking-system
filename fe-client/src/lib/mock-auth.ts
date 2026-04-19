import { isLoggedIn, signIn, signOut } from "./mock-state";

export { isLoggedIn };

export function setLoggedIn(v: boolean) {
  if (v) signIn();
  else signOut();
}
