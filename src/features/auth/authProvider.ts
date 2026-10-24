/** The signed-in Mnemonis server account, as shown in the app. */
export interface AuthUser {
  /** Server user id. */
  id?: string;
  displayName: string;
  email: string;
  createdAt?: string;
}
