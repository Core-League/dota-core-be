/**
 * Minimal typings for the parts of `steam-user` the host bot uses. The
 * package ships no declarations; everything here mirrors its README
 * (logOn / gamesPlayed / sendToGC and the events we subscribe to).
 */
declare module 'steam-user' {
  import { EventEmitter } from 'node:events';

  interface SteamUserOptions {
    /** null disables on-disk storage of sentry / refresh tokens. */
    dataDirectory?: string | null;
    autoRelogin?: boolean;
    /** Milliseconds; default 60000. */
    webCompatibilityMode?: boolean;
  }

  interface LogOnDetails {
    accountName: string;
    password?: string;
    refreshToken?: string;
    logonID?: number;
    machineName?: string;
    clientOS?: number;
  }

  interface SteamIDLike {
    getSteamID64(): string;
    accountid: number;
  }

  class SteamUser extends EventEmitter {
    constructor(options?: SteamUserOptions);

    steamID: SteamIDLike | null;
    logOn(details: LogOnDetails): void;
    logOff(): void;
    setPersona(state: number, name?: string): void;
    gamesPlayed(apps: number[] | number, force?: boolean): void;
    sendToGC(
      appid: number,
      msgType: number,
      protoBufHeader: Record<string, unknown> | null,
      payload: Buffer,
      callback?: (appid: number, msgType: number, payload: Buffer) => void,
    ): void;

    on(event: 'loggedOn', listener: (details: unknown) => void): this;
    on(
      event: 'disconnected',
      listener: (eresult: number, msg?: string) => void,
    ): this;
    on(
      event: 'error',
      listener: (err: Error & { eresult?: number }) => void,
    ): this;
    on(event: 'appLaunched', listener: (appid: number) => void): this;
    on(event: 'appQuit', listener: (appid: number) => void): this;
    on(
      event: 'receivedFromGC',
      listener: (appid: number, msgType: number, payload: Buffer) => void,
    ): this;
    on(
      event: 'steamGuard',
      listener: (
        domain: string | null,
        callback: (code: string) => void,
        lastCodeWrong: boolean,
      ) => void,
    ): this;
    on(event: 'debug', listener: (msg: string) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;

    static EPersonaState: { Online: number; Offline: number };
    static EResult: Record<string, number> & Record<number, string>;
  }

  export = SteamUser;
}
