/**
 * Group enablement must not remount the editor.
 * The Enable/Disable button lives on the open group route. A remount would
 * return a clean editor to the project page and would drop a dirty draft.
 */
export function shouldRemountEditorAfterGroupEnablement(): boolean {
  return false;
}
