export function slugifyBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

export function customPresetIdForName(name: string): string {
  return `custom_${slugifyBaseName(name)}`;
}
