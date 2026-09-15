export type PackageNotice = { name: string; version: string; license: string; notices: string[] };
export function resolvePackageDirectory(name: string, fromDirectory: string): string;
export function readPackageNotice(directory: string): PackageNotice;
export function assertPermissiveLicense(entry: PackageNotice): PackageNotice;
export function collectRuntimeNotices(packageRoot: string, extraPackageNames?: string[]): PackageNotice[];
export function assertNoticesRetained(text: string, entries: PackageNotice[], label: string): void;
export function assertInventoryRetained(inventory: Pick<PackageNotice, 'name' | 'version' | 'license'>[], text: string, candidates: PackageNotice[], requiredNames?: string[]): PackageNotice[];
