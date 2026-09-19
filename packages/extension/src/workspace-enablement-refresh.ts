/**
 * Decide whether Workspace may remount the editor after a group enablement change.
 * Dirty drafts must stay mounted; clean editors can take a full shell refresh.
 */
export function shouldRemountEditorAfterGroupEnablement(
  editorDirty: boolean,
): boolean {
  return editorDirty !== true;
}
