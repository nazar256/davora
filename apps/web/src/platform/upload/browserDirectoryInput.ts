export function applyBrowserDirectoryUploadAttributes(input: HTMLInputElement | null): void {
  if (!input) {
    return;
  }

  input.multiple = true;
  input.setAttribute("multiple", "");
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).webkitdirectory = true;
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).directory = true;
}
