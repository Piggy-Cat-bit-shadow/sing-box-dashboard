import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { Transport } from "@connectrpc/connect";

import type { StreamSnapshot } from "../api/stream";
import type { NetworkQualityTestProgress, STUNTestProgress } from "../gen/daemon/started_service_pb";
import type { PreferenceStorage } from "../lib/storage";
import { showError } from "./errorStore";
import { useLatestRef } from "./useLatest";

export type DaemonConnectionPhase =
  | "connecting"
  | "connected"
  | "owned-by-other-user"
  | "unavailable"
  | "not-installed"
  | "not-running"
  | "version-mismatch";

export interface DaemonConnectionState {
  phase: DaemonConnectionPhase;
  errorMessage?: string;
  daemonVersion?: string;
  bundledDaemonVersion?: string;
}

export type DesktopProfileType = "local" | "remote";

/**
 * The last subscription quota a remote profile's provider reported.
 *
 * Mirrors `ProfileSubscriptionQuota` in the desktop shell's `src/shared/ipc.ts`, which is
 * what arrives over the profile list. The two are declared separately because the dashboard
 * is a standalone package: this side is the transport shape, and the desktop side is the
 * persistence shape.
 */
export interface DesktopProfileSubscription {
  /** Bytes uploaded, as the provider reported them. */
  upload?: number;
  /** Bytes downloaded, as the provider reported them. */
  download?: number;
  /** Quota total in bytes. Absent when the provider sells no fixed quota. */
  total?: number;
  /** Unix timestamp in SECONDS, exactly as the header carried it. */
  expire?: number;
  /**
   * When this snapshot arrived, in milliseconds.
   *
   * NOT `lastUpdated`: that one is when the profile CONTENT was last refreshed, and a
   * provider can stop sending the header at any time, so the two genuinely differ.
   */
  updatedAt: number;
}

export interface DesktopProfile {
  id: string;
  name: string;
  type: DesktopProfileType;
  remoteUrl?: string;
  autoUpdate: boolean;
  autoUpdateIntervalMinutes: number;
  lastUpdated?: number;
  subscription?: DesktopProfileSubscription;
}

export interface DesktopProfilesState {
  selectedId: string | null;
  profiles: DesktopProfile[];
}

/**
 * The two halves of a remote-profile update.
 *
 * Mirrors `RemoteProfileUpdate` in the desktop shell's `src/shared/remoteUpdate.ts`. Declared
 * separately because this dashboard is a standalone package: the shell owns the daemon, this side
 * owns the rendering of what the shell reports. `updateRemote` used to resolve `void`, so neither
 * half could be shown and any non-throwing outcome looked the same.
 */
export type DesktopConfigUpdateStatus =
  | "unchanged"
  | "applied"
  | "saved"
  | "apply-failed"
  | "apply-unconfirmed"
  | "invalid-config"
  | "download-failed"
  | "superseded";

export type DesktopProviderUpdateStatus =
  | "published"
  | "unchanged"
  | "partial"
  | "failed"
  | "busy"
  | "cancelled"
  | "box-changed"
  | "none"
  | "not-active"
  | "not-running"
  | "superseded"
  | "unsupported"
  | "unavailable";

export interface DesktopProviderUpdateCounts {
  published: number;
  unchanged: number;
  failed: number;
  skipped: number;
  busy: number;
  pending: number;
  restartRequired: number;
  total: number;
}

export interface DesktopRemoteProfileUpdate {
  profileId: string;
  changed: boolean;
  config: {
    status: DesktopConfigUpdateStatus;
    detail?: string;
    previousStartedAt?: string;
    startedAt?: string;
  };
  providers: {
    status: DesktopProviderUpdateStatus;
    counts?: DesktopProviderUpdateCounts;
    detail?: string;
  };
}

/**
 * The daemon's configuration documents (`PreviewServiceChange` / `GetLastServiceChange` /
 * `GetLastConfigRecovery`), as the shell relays them.
 *
 * Declared here rather than imported from the shell for the same reason as the remote-update
 * types: this dashboard is a standalone package and the shell is the other side of a process
 * boundary. The kernel's JSON is the contract; these interfaces name the fields this UI reads,
 * and unknown fields are deliberately kept by the shell so a newer kernel does not break an
 * older client.
 */
export interface DesktopDomainChange {
  kind: string;
  from?: string;
  to?: string;
  detail?: string;
}

export interface DesktopServiceChangeDomainPlan {
  domain: string;
  supported: boolean;
  unsupportedReason?: string;
  restartRequired: boolean;
  changes?: DesktopDomainChange[];
  currentRevision?: string;
  targetRevision?: string;
}

export interface DesktopProviderDomainPlan {
  domain: string;
  supported: boolean;
  unsupportedReason?: string;
  tags?: string[];
  liveRefresh?: boolean;
  liveRefreshReason?: string;
  currentRevision?: string;
  targetRevision?: string;
}

export interface DesktopServiceChangePlan {
  started: boolean;
  currentRevision?: string;
  targetRevision?: string;
  unchanged: boolean;
  liveOnly: boolean;
  restartRequired: boolean;
  changedDocument: boolean;
  stale?: boolean;
  changedSections?: string[];
  mode?: DesktopServiceChangeDomainPlan;
  dns?: DesktopServiceChangeDomainPlan;
  rule?: DesktopServiceChangeDomainPlan;
  provider?: DesktopProviderDomainPlan;
}

export interface DesktopProviderRefreshResult {
  tag: string;
  status: string;
  requestedRevision?: number;
  appliedRevision?: number;
  pendingTags?: string[];
  restartRequired?: boolean;
  reason?: string;
}

export interface DesktopProviderDomainReport {
  domain: string;
  status: string;
  results?: DesktopProviderRefreshResult[];
  restartRequired: boolean;
  reason?: string;
  revision?: string;
}

export interface DesktopServiceChangeReport {
  plan: DesktopServiceChangePlan;
  status: string;
  restartRequired: boolean;
  retained: boolean;
  activeRevision?: string;
  persistence?: string;
  persistenceWarning?: string;
  reason?: string;
  time: string;
  applied?: DesktopDomainChange[];
  provider?: DesktopProviderDomainReport;
}

export interface DesktopConfigRecoveryInfo {
  time: string;
  failedRevision: string;
  activeRevision: string;
  error: string;
}

/** One configuration document, or the reason the shell has none. */
export type DesktopConfigurationDocument<T> =
  | { kind: "document"; document: T }
  | { kind: "absent" }
  | { kind: "unsupported" };

export interface DesktopServer {
  id: string;
  name: string;
  url: string;
  secret: string;
}

export interface DesktopServersState {
  servers: DesktopServer[];
  activeId: string | null;
}

export interface DesktopProfileCreate {
  name: string;
  type: DesktopProfileType;
  content?: string;
  remoteUrl?: string;
  autoUpdate?: boolean;
  autoUpdateIntervalMinutes?: number;
}

export interface DesktopProfilePatch {
  name?: string;
  remoteUrl?: string;
  autoUpdate?: boolean;
  autoUpdateIntervalMinutes?: number;
}

export interface DesktopCrashReport {
  name: string;
  crashedAt: number;
  isRead: boolean;
}

export interface DesktopCrashReportFile {
  name: string;
  content: string;
  isBinary: boolean;
}

export interface DesktopOOMReport {
  name: string;
  recordedAt: number;
  isRead: boolean;
}

export interface DesktopOOMReportFile {
  name: string;
  content: string;
  isProfile: boolean;
}

export interface DesktopCrashReportExportOptions {
  withConfiguration: boolean;
  withLog: boolean;
  encrypt: boolean;
}

export interface DesktopReportArchive {
  fileName: string;
  data: Uint8Array;
  mediaType: string;
}

export type DesktopSpeedMode = "disabled" | "enabled" | "unified";

export type DesktopUpdateTrack = "stable" | "beta";
export type DesktopUpdateInstallResult = "started" | "signer-mismatch" | "not-newer";

export interface DesktopUpdateInfo {
  versionName: string;
  releaseURL: string;
  downloadURL: string;
  releaseNotes: string;
  isPrerelease: boolean;
  fileSize: number;
}

export interface DesktopUpdatesState {
  supported: boolean;
  track: DesktopUpdateTrack;
  checkUpdateEnabled: boolean;
  prompted: boolean;
  info: DesktopUpdateInfo | null;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  downloadProgress: number;
}

export interface DesktopSettingsState {
  speedMode: DesktopSpeedMode;
  openAtLogin: boolean;
  trayEnabled: boolean;
  trayInBackground: boolean;
  oomKillerEnabled: boolean;
  oomMemoryLimitMB: number;
  oomKillerKillConnections: boolean;
  powerReportEnabled: boolean;
}

export type DesktopTerminalContextMenuResult =
  | { action: "copy" }
  | { action: "paste"; text: string }
  | null;

export interface DesktopOpenConnectBrowserRequest {
  url: string;
  finalURL: string;
  cookieNames: string[];
  earlyCookieNames: string[];
  headerNames: string[];
  callbackURLPrefixes: string[];
}

export interface DesktopOpenConnectBrowserResult {
  finalURL: string;
  cookies: Array<{ name: string; value: string }>;
  headers: Array<{ name: string; values: string[] }>;
}

export interface DesktopTaildropFile {
  name: string;
  size: number;
  path: string;
}

export type DesktopTaildropSendEvent =
  | {
      sessionID: number;
      type: "progress";
      fileIndex: number;
      sentBytes: number;
      fileCompleted: boolean;
    }
  | { sessionID: number; type: "finished"; code: number; error: string };

export interface DesktopTaildropDownloadProgress {
  downloadID: number;
  transferred: number;
  size: number;
}

export type DesktopTaildropDownloadAction = "save" | "open" | "share";

export interface DesktopTaildropDownloadRequest {
  downloadID: number;
  endpointTag: string;
  name: string;
  action: DesktopTaildropDownloadAction;
}

export interface DesktopTaildropSendRequest {
  endpointTag: string;
  peerStableID: string;
  files: DesktopTaildropFile[];
}

export interface DesktopHost {
  platform: string;
  appVersion(): Promise<string>;
  transport: Transport;
  preferences: PreferenceStorage;
  daemon: {
    getState(): Promise<DaemonConnectionState>;
    onStateChanged(listener: (state: DaemonConnectionState) => void): () => void;
    retryConnection(): void;
  };
  terminal: {
    openWindow(route: string): void;
    closeWindow(): void;
    readClipboardText(): Promise<string>;
    writeClipboardText(text: string): Promise<void>;
    openContextMenu(selectionText: string): Promise<DesktopTerminalContextMenuResult>;
  };
  profileEditor: {
    openWindow(profileId: string, readOnly: boolean): void;
    closeWindow(): void;
    setDirty(dirty: boolean): void;
    onCloseRequested(listener: () => void): () => void;
  };
  openConnectBrowser: {
    authenticate(
      browserSessionID: string,
      storageID: string,
      request: DesktopOpenConnectBrowserRequest,
    ): Promise<DesktopOpenConnectBrowserResult | null>;
    cancel(browserSessionID: string): void;
  };
  setup: {
    repairInstall(): Promise<boolean>;
    repairStart(): Promise<boolean>;
  };
  service: {
    start(): Promise<void>;
    stop(): Promise<void>;
    takeOver(): Promise<void>;
  };
  servers: {
    load(): Promise<DesktopServersState>;
    save(state: DesktopServersState): Promise<void>;
  };
  configuration: {
    check(content: string): Promise<void>;
    format(content: string): Promise<string>;
    generateSchema(): Promise<string>;
    /**
     * What applying `content` would mean for the running instance.
     *
     * `absent`/`unsupported` are results, not exceptions: the first means the daemon has no plan
     * to report, the second that this kernel does not have the RPC at all.
     */
    previewChange(content: string): Promise<DesktopConfigurationDocument<DesktopServiceChangePlan>>;
    /** What the last apply attempt planned and did. */
    lastServiceChange(): Promise<DesktopConfigurationDocument<DesktopServiceChangeReport>>;
    /** The last recovery from a failed start, or `absent` when the last start was normal. */
    lastConfigRecovery(): Promise<DesktopConfigurationDocument<DesktopConfigRecoveryInfo>>;
  };
  tools: {
    startStandaloneNetworkQualityTest(
      request: { configURL: string; serial: boolean; http3: boolean; maxRuntimeSeconds: number },
      options: { signal: AbortSignal },
    ): AsyncIterable<NetworkQualityTestProgress>;
    startStandaloneSTUNTest(
      request: { server: string },
      options: { signal: AbortSignal },
    ): AsyncIterable<STUNTestProgress>;
  };
  systemProxy: {
    status(): Promise<{ available: boolean; enabled: boolean }>;
    setEnabled(enabled: boolean): Promise<void>;
  };
  core: {
    info(): Promise<{ version: string }>;
    securitySettings(): Promise<{ available: boolean; insecureModeEnabled: boolean }>;
    setInsecureModeEnabled(enabled: boolean): Promise<void>;
    workingDirectory(): Promise<{ path: string; size: number }>;
    destroyWorkingDirectory(): Promise<void>;
  };
  reports: {
    crash: {
      list(): Promise<DesktopCrashReport[]>;
      read(name: string): Promise<DesktopCrashReportFile[]>;
      markRead(name: string): Promise<void>;
      exportFile(name: string, options: DesktopCrashReportExportOptions): Promise<boolean>;
      createArchive(name: string, options: DesktopCrashReportExportOptions): Promise<DesktopReportArchive>;
      remove(name: string): Promise<void>;
      removeAll(): Promise<void>;
    };
    oom: {
      list(): Promise<DesktopOOMReport[]>;
      read(name: string): Promise<DesktopOOMReportFile[]>;
      markRead(name: string): Promise<void>;
      exportFile(name: string, options: DesktopCrashReportExportOptions): Promise<boolean>;
      createArchive(name: string, options: DesktopCrashReportExportOptions): Promise<DesktopReportArchive>;
      remove(name: string): Promise<void>;
      removeAll(): Promise<void>;
    };
    power: {
      list(): Promise<DesktopOOMReport[]>;
      read(name: string): Promise<DesktopOOMReportFile[]>;
      markRead(name: string): Promise<void>;
      exportFile(name: string, options: DesktopCrashReportExportOptions): Promise<boolean>;
      createArchive(name: string, options: DesktopCrashReportExportOptions): Promise<DesktopReportArchive>;
      remove(name: string): Promise<void>;
      removeAll(): Promise<void>;
    };
    triggerDebugCrash(type: "go" | "native"): Promise<void>;
    triggerAppCrash(type: "js" | "native"): Promise<void>;
    triggerOOMReport(): Promise<void>;
  };
  profiles: {
    list(): Promise<DesktopProfilesState>;
    onChanged(listener: () => void): () => void;
    create(init: DesktopProfileCreate): Promise<void>;
    updateMetadata(id: string, patch: DesktopProfilePatch): Promise<void>;
    remove(id: string): Promise<void>;
    reorder(ids: string[]): Promise<void>;
    select(id: string): Promise<void>;
    readContent(id: string): Promise<string>;
    writeContent(id: string, content: string): Promise<void>;
    updateRemote(id: string): Promise<DesktopRemoteProfileUpdate>;
    pickImportFile(): Promise<{ fileName: string; data: Uint8Array } | null>;
    exportFile(id: string): Promise<boolean>;
    importData(fileName: string, data: Uint8Array): Promise<void>;
    decodeData(data: Uint8Array): Promise<{ name: string }>;
    exportData(id: string): Promise<boolean>;
    encodeData(id: string): Promise<Uint8Array>;
  };
  settings: {
    get(): Promise<DesktopSettingsState>;
    setSpeedMode(mode: DesktopSpeedMode): Promise<void>;
    setOpenAtLogin(value: boolean): Promise<void>;
    setTrayEnabled(value: boolean): Promise<void>;
    setTrayInBackground(value: boolean): Promise<void>;
    setOOMKillerEnabled(value: boolean): Promise<void>;
    setOOMMemoryLimitMB(value: number): Promise<void>;
    setOOMKillerKillConnections(value: boolean): Promise<void>;
    setPowerReportEnabled(value: boolean): Promise<void>;
    cacheSize(): Promise<number>;
    clearCache(): Promise<void>;
  };
  updates: {
    state(): Promise<DesktopUpdatesState>;
    check(): Promise<DesktopUpdateInfo | null>;
    getGitHubToken(): Promise<string>;
    setGitHubToken(value: string): Promise<void>;
    downloadAndInstall(): Promise<DesktopUpdateInstallResult>;
    installWithElevation(): Promise<boolean>;
    setTrack(track: DesktopUpdateTrack): Promise<void>;
    setCheckUpdateEnabled(value: boolean): Promise<void>;
    setPrompted(): Promise<void>;
    markShown(): Promise<void>;
    onStateChanged(listener: (state: DesktopUpdatesState) => void): () => void;
    onPresentRequested(listener: () => void): () => void;
  };
  taildrop: {
    pathForFile(file: File): string;
    startSend(sessionID: number, request: DesktopTaildropSendRequest): void;
    cancelSend(sessionID: number): void;
    onSendEvent(listener: (event: DesktopTaildropSendEvent) => void): () => void;
    download(request: DesktopTaildropDownloadRequest): Promise<boolean>;
    onDownloadProgress(listener: (progress: DesktopTaildropDownloadProgress) => void): () => void;
  };
  // window.close() destroys sandboxed renderer webContents without emitting the host window's close event.
  application: {
    shareFile(fileName: string, data: Uint8Array | string): Promise<void>;
    showMainWindow(): void;
    closeTrayMenu(): void;
    quit(): void;
  };
  onImportRemoteProfile(listener: (request: { name: string; url: string }) => void): () => void;
  onImportProfileFile(listener: (request: { fileName: string; data: Uint8Array }) => void): () => void;
  onTaildropSendRequested(listener: (files: DesktopTaildropFile[]) => void): () => void;
}

export const DesktopHostContext = createContext<DesktopHost | null>(null);

export function useDesktopHost(): DesktopHost | null {
  return useContext(DesktopHostContext);
}

export const DesktopLocalContext = createContext(false);

export function useLocalDesktopHost(): DesktopHost | null {
  const host = useContext(DesktopHostContext);
  const local = useContext(DesktopLocalContext);
  return local ? host : null;
}

export function useDaemonConnection(host: DesktopHost): DaemonConnectionState {
  const [state, setState] = useState<DaemonConnectionState>({ phase: "connecting" });

  useEffect(() => {
    let stale = false;
    let pushed = false;
    const unsubscribe = host.daemon.onStateChanged((value) => {
      pushed = true;
      setState(() => value);
    });
    host.daemon
      .getState()
      .then((value) => {
        if (!stale && !pushed) {
          setState(() => value);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [host]);

  return state;
}

export interface RemoteSessionFailure {
  hadConnected: boolean;
  message: string;
}

export function useRemoteSession(
  monitor: StreamSnapshot<unknown> | null,
  onEnd: (failure: RemoteSessionFailure) => void,
) {
  const onEndRef = useLatestRef(onEnd);
  const hadConnected = useRef(false);
  const phase = monitor?.phase ?? null;
  const errorMessage = monitor?.error;

  useEffect(() => {
    if (phase === "active") {
      hadConnected.current = true;
    } else if (phase === "error") {
      onEndRef.current({ hadConnected: hadConnected.current, message: errorMessage ?? "" });
    }
  }, [onEndRef, phase, errorMessage]);
}

export function useDesktopProfiles(host: DesktopHost): DesktopProfilesState {
  const [state, setState] = useState<DesktopProfilesState>({ selectedId: null, profiles: [] });

  useEffect(() => {
    let stale = false;
    let sequence = 0;
    const reload = () => {
      const token = ++sequence;
      host.profiles
        .list()
        .then((value) => {
          if (!stale && token === sequence) {
            setState(() => value);
          }
        })
        .catch(showError);
    };
    reload();
    const unsubscribe = host.profiles.onChanged(reload);
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [host]);

  return state;
}
