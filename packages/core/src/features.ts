export type FeatureFlags<TFeature extends string> = Partial<Record<TFeature, boolean>>;

/** Only declared keys are returned. Undefined values preserve their defaults. */
export function resolveFeatureFlags<TFeature extends string>(
  defaults: Readonly<Record<TFeature, boolean>>,
  overrides?: Readonly<FeatureFlags<TFeature>>,
): Record<TFeature, boolean> {
  const resolved: Record<TFeature, boolean> = { ...defaults };
  for (const key of Object.keys(defaults) as TFeature[]) {
    resolved[key] = overrides?.[key] ?? defaults[key];
  }
  return resolved;
}
