export function safeClone(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new Error("cycle");
  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length > 0)
      throw new Error("symbol");
    if (Array.isArray(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0
      )
        throw new Error("array");
      const result: unknown[] = [];
      for (let index = 0; index < descriptor.value; index += 1) {
        const entry = Object.getOwnPropertyDescriptor(value, String(index));
        if (!entry || !("value" in entry) || !entry.enumerable)
          throw new Error("sparse");
        result.push(safeClone(entry.value, ancestors));
      }
      return result;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new Error("accessor");
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: safeClone(descriptor.value, ancestors),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
