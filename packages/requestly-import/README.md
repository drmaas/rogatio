# @rogatio/requestly-import

Pure mapping from a Requestly rule export to a version-2 Rogatio project.

The package depends only on `@rogatio/schema`. It does not read files, contact
the network, or run the compiler. `rogatio import requestly` is the CLI that
reads an export, calls `importRequestlyExport`, validates the result, and writes
`.rogatio.json`.

`mergeProjects` appends an imported project onto an existing one. Names and ids
that collide are regenerated and listed.
