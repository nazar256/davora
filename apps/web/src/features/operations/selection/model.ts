import type { FileEntry, NormalizedPath } from "@davora/shared";
import { parseNormalizedPath } from "@davora/shared";

export type SelectionOrigin =
  | { readonly kind: "browse"; readonly folderPath: string }
  | { readonly kind: "search"; readonly scopePath: string };

export interface BatchSelectionIdentity {
  readonly accountId: string;
  readonly path: NormalizedPath;
}

export interface BatchSelectionMembership {
  readonly identity: BatchSelectionIdentity;
  readonly descriptor: SelectedResourceDescriptor;
  readonly origin: SelectionOrigin;
  readonly membershipVersion: number;
}

export type SelectedResourceDescriptor = Readonly<Omit<FileEntry, "path"> & { readonly path: NormalizedPath }>;

export interface BatchSelectionState {
  readonly accountId?: string;
  readonly memberships: readonly BatchSelectionMembership[];
  readonly nextMembershipVersion: number;
}

export interface BatchSelectionCapture {
  readonly accountId?: string;
  readonly memberships: readonly Pick<BatchSelectionMembership, "identity" | "membershipVersion">[];
}

export interface BatchSelectionTransition {
  readonly state: BatchSelectionState;
  readonly outcome: "added" | "removed" | "rejected";
}

export type MobileSelectionSubview = "actions" | "details";

export interface FocusedSelectionIdentity {
  readonly accountId: string;
  readonly path: NormalizedPath;
}

export interface FocusedSelectionMembership {
  readonly identity: FocusedSelectionIdentity;
  readonly descriptor: SelectedResourceDescriptor;
  readonly version: number;
}

export type FocusedSelectionState =
  | {
    readonly kind: "empty";
    readonly accountId?: string;
    readonly nextVersion: number;
    readonly mobileSubview: MobileSelectionSubview;
  }
  | {
    readonly kind: "selected";
    readonly accountId: string;
    readonly selection: FocusedSelectionMembership;
    readonly nextVersion: number;
    readonly mobileSubview: MobileSelectionSubview;
  };

export interface FocusedSelectionCapture {
  readonly identity: FocusedSelectionIdentity;
  readonly version: number;
}

function canonicalPath(path: string, allowRoot: boolean): NormalizedPath | undefined {
  try {
    const parsed = parseNormalizedPath(path);
    return parsed === path && (allowRoot || parsed.length > 0) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOrigin(origin: SelectionOrigin): SelectionOrigin | undefined {
  const path = canonicalPath(origin.kind === "browse" ? origin.folderPath : origin.scopePath, true);
  if (path === undefined) {
    return undefined;
  }
  return origin.kind === "browse"
    ? { kind: "browse", folderPath: path }
    : { kind: "search", scopePath: path };
}

function normalizeDescriptor(entry: FileEntry): SelectedResourceDescriptor | undefined {
  const path = canonicalPath(entry.path, false);
  if (!path || typeof entry.name !== "string" || !entry.name || typeof entry.isFolder !== "boolean") {
    return undefined;
  }
  if (entry.size !== undefined && (typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size < 0)) {
    return undefined;
  }
  for (const value of [entry.mimeType, entry.lastModified, entry.etag, entry.permissions, entry.ownerDisplayName]) {
    if (value !== undefined && typeof value !== "string") {
      return undefined;
    }
  }
  return {
    path,
    name: entry.name,
    isFolder: entry.isFolder,
    ...(entry.size === undefined ? {} : { size: entry.size }),
    ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
    ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
    ...(entry.etag === undefined ? {} : { etag: entry.etag }),
    ...(entry.permissions === undefined ? {} : { permissions: entry.permissions }),
    ...(entry.ownerDisplayName === undefined ? {} : { ownerDisplayName: entry.ownerDisplayName })
  };
}

export function parseSelectedResourceDescriptor(entry: FileEntry): SelectedResourceDescriptor | undefined {
  return normalizeDescriptor(entry);
}

function normalizeAccountId(accountId: string | undefined): string | undefined {
  return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
}

export function createFocusedSelectionState(accountId?: string): FocusedSelectionState {
  return {
    kind: "empty",
    accountId: normalizeAccountId(accountId),
    nextVersion: 1,
    mobileSubview: "actions"
  };
}

export function replaceFocusedSelectionAccount(
  state: FocusedSelectionState,
  accountId?: string
): FocusedSelectionState {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (state.accountId === normalizedAccountId) {
    return state;
  }
  return {
    kind: "empty",
    accountId: normalizedAccountId,
    nextVersion: state.nextVersion,
    mobileSubview: "actions"
  };
}

export function selectFocusedEntry(
  state: FocusedSelectionState,
  accountId: string,
  entry: FileEntry
): FocusedSelectionState {
  const normalizedAccountId = normalizeAccountId(accountId);
  const descriptor = parseSelectedResourceDescriptor(entry);
  if (!normalizedAccountId || state.accountId !== normalizedAccountId || !descriptor) {
    return state;
  }
  return {
    kind: "selected",
    accountId: normalizedAccountId,
    selection: {
      identity: { accountId: normalizedAccountId, path: descriptor.path },
      descriptor,
      version: state.nextVersion
    },
    nextVersion: state.nextVersion + 1,
    mobileSubview: "actions"
  };
}

export function toggleFocusedEntry(
  state: FocusedSelectionState,
  accountId: string,
  entry: FileEntry
): FocusedSelectionState {
  const descriptor = parseSelectedResourceDescriptor(entry);
  if (state.kind === "selected" && descriptor && state.selection.identity.path === descriptor.path) {
    return clearFocusedSelection(state, accountId);
  }
  return selectFocusedEntry(state, accountId, entry);
}

export function clearFocusedSelection(state: FocusedSelectionState, accountId: string): FocusedSelectionState {
  if (state.accountId !== normalizeAccountId(accountId) || state.kind === "empty") {
    return state;
  }
  return {
    kind: "empty",
    accountId: state.accountId,
    nextVersion: state.nextVersion,
    mobileSubview: "actions"
  };
}

export function captureFocusedSelection(state: FocusedSelectionState): FocusedSelectionCapture | undefined {
  return state.kind === "selected"
    ? { identity: { ...state.selection.identity }, version: state.selection.version }
    : undefined;
}

export function isFocusedSelectionCurrent(
  state: FocusedSelectionState,
  capture: FocusedSelectionCapture
): state is Extract<FocusedSelectionState, { kind: "selected" }> {
  return state.kind === "selected"
    && state.selection.identity.accountId === capture.identity.accountId
    && state.selection.identity.path === capture.identity.path
    && state.selection.version === capture.version;
}

export function clearFocusedSelectionIfCurrent(
  state: FocusedSelectionState,
  capture: FocusedSelectionCapture
): FocusedSelectionState {
  return isFocusedSelectionCurrent(state, capture)
    ? clearFocusedSelection(state, capture.identity.accountId)
    : state;
}

export function rebindFocusedSelectionIfCurrent(
  state: FocusedSelectionState,
  capture: FocusedSelectionCapture,
  entry: FileEntry
): FocusedSelectionState {
  if (!isFocusedSelectionCurrent(state, capture)) {
    return state;
  }
  const descriptor = parseSelectedResourceDescriptor(entry);
  if (!descriptor) {
    return state;
  }
  return {
    ...state,
    selection: {
      identity: { accountId: capture.identity.accountId, path: descriptor.path },
      descriptor,
      version: capture.version
    }
  };
}

export function removeDeletedFocusedSelection(
  state: FocusedSelectionState,
  accountId: string,
  path: string
): FocusedSelectionState {
  const deletedPath = canonicalPath(path, false);
  if (
    state.kind !== "selected"
    || state.accountId !== normalizeAccountId(accountId)
    || !deletedPath
    || !isSameOrDescendant(state.selection.identity.path, deletedPath)
  ) {
    return state;
  }
  return clearFocusedSelection(state, accountId);
}

export function showFocusedMobileActions(state: FocusedSelectionState): FocusedSelectionState {
  return state.mobileSubview === "actions" ? state : { ...state, mobileSubview: "actions" };
}

export function showFocusedMobileDetails(state: FocusedSelectionState): FocusedSelectionState {
  return state.mobileSubview === "details" ? state : { ...state, mobileSubview: "details" };
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function createBatchSelectionState(accountId?: string): BatchSelectionState {
  return { accountId, memberships: [], nextMembershipVersion: 1 };
}

export function replaceBatchSelectionAccount(state: BatchSelectionState, accountId?: string): BatchSelectionState {
  if (state.accountId === accountId) {
    return state;
  }
  return { accountId, memberships: [], nextMembershipVersion: state.nextMembershipVersion };
}

export function toggleBatchSelection(
  state: BatchSelectionState,
  accountId: string,
  entry: FileEntry,
  origin: SelectionOrigin
): BatchSelectionTransition {
  if (!accountId || state.accountId !== accountId) {
    return { state, outcome: "rejected" };
  }
  const descriptor = normalizeDescriptor(entry);
  const normalizedOrigin = normalizeOrigin(origin);
  if (!descriptor || !normalizedOrigin) {
    return { state, outcome: "rejected" };
  }
  const existing = state.memberships.find((membership) => membership.identity.path === descriptor.path);
  if (existing) {
    return {
      state: { ...state, memberships: state.memberships.filter((membership) => membership !== existing) },
      outcome: "removed"
    };
  }
  const membership: BatchSelectionMembership = {
    identity: { accountId, path: descriptor.path },
    descriptor,
    origin: normalizedOrigin,
    membershipVersion: state.nextMembershipVersion
  };
  return {
    state: {
      ...state,
      memberships: [...state.memberships, membership],
      nextMembershipVersion: state.nextMembershipVersion + 1
    },
    outcome: "added"
  };
}

export function clearBatchSelection(state: BatchSelectionState, accountId: string): BatchSelectionState {
  return state.accountId === accountId && state.memberships.length > 0
    ? { ...state, memberships: [] }
    : state;
}

export function rebindBatchSelection(
  state: BatchSelectionState,
  accountId: string,
  sourcePath: string,
  entry: FileEntry
): BatchSelectionState {
  if (state.accountId !== accountId || !canonicalPath(sourcePath, false)) {
    return state;
  }
  const descriptor = normalizeDescriptor(entry);
  const sourceIndex = state.memberships.findIndex((membership) => membership.identity.path === sourcePath);
  if (!descriptor || sourceIndex < 0) {
    return state;
  }
  const source = state.memberships[sourceIndex];
  const memberships = state.memberships
    .filter((membership, index) => index === sourceIndex || membership.identity.path !== descriptor.path)
    .map((membership) => membership === source
      ? { ...membership, identity: { accountId, path: descriptor.path }, descriptor }
      : membership);
  return { ...state, memberships };
}

export function removeDeletedPath(state: BatchSelectionState, accountId: string, path: string): BatchSelectionState {
  const deletedPath = canonicalPath(path, false);
  if (state.accountId !== accountId || !deletedPath) {
    return state;
  }
  const memberships = state.memberships.filter((membership) => !isSameOrDescendant(membership.identity.path, deletedPath));
  return memberships.length === state.memberships.length ? state : { ...state, memberships };
}

export function retainBatchSelectionPaths(state: BatchSelectionState, accountId: string, paths: readonly string[]): BatchSelectionState {
  if (state.accountId !== accountId) {
    return state;
  }
  const retained = new Set(paths.filter((path) => canonicalPath(path, false) === path));
  const memberships = state.memberships.filter((membership) => retained.has(membership.identity.path));
  return memberships.length === state.memberships.length ? state : { ...state, memberships };
}

export function captureBatchSelection(state: BatchSelectionState): BatchSelectionCapture {
  return {
    accountId: state.accountId,
    memberships: state.memberships.map((membership) => ({
      identity: { ...membership.identity },
      membershipVersion: membership.membershipVersion
    }))
  };
}

export function removeCapturedSelection(state: BatchSelectionState, capture: BatchSelectionCapture): BatchSelectionState {
  if (!capture.accountId || state.accountId !== capture.accountId) {
    return state;
  }
  const capturedVersions = new Map(capture.memberships.map((membership) => [membership.identity.path, membership.membershipVersion]));
  const memberships = state.memberships.filter((membership) => capturedVersions.get(membership.identity.path) !== membership.membershipVersion);
  return memberships.length === state.memberships.length ? state : { ...state, memberships };
}
