import type { OfficePackageSignal } from "../ooxml";

export type OfficeTaskCheckpoint = () => Promise<void>;
/** Yield to the host periodically without truncating work or changing precision. */
export function createOfficeTaskCheckpoint(signal?: OfficePackageSignal): OfficeTaskCheckpoint {
  let completed = 0;
  return async () => {
    signal?.throwIfAborted();
    if (++completed % 256 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
  };
}
