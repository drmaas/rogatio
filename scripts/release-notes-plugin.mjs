/**
 * semantic-release plugin (F21): appends an npm package link to the GitHub
 * release notes so each release ties back to the published @rogatio/cli version.
 * Runs during the `generateNotes` phase; its output is concatenated after the
 * release-notes-generator output.
 */
export default {
  async generateNotes(_config, context) {
    const version = context.nextRelease?.version;
    if (!version) return;

    return [
      `## Install`,
      ``,
      `This release publishes [\`@rogatio/cli@${version}\`](https://www.npmjs.com/package/@rogatio/cli/v/${version}). Install globally with your preferred package manager:`,
      ``,
      "```sh",
      `npm install -g @rogatio/cli@${version}`,
      `pnpm add -g @rogatio/cli@${version}`,
      `bun add -g @rogatio/cli@${version}`,
      `vp install -g @rogatio/cli@${version}`,
      "```",
      ``,
    ].join("\n");
  },
};
