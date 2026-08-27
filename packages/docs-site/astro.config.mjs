import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://starlight.astro.build/reference/configuration/
export default defineConfig({
  integrations: [
    starlight({
      title: "Rogatio",
      description:
        "Local-first browser request and response rules — CLI, Chrome extension, and a version-controlled .rogatio.json project file.",
      lastUpdated: true,
      sidebar: [
        {
          label: "Overview",
          items: [{ label: "Introduction", link: "/" }],
        },
        {
          label: "Getting started",
          items: [
            { label: "Installation", link: "/getting-started/installation/" },
            { label: "Quick start", link: "/getting-started/quick-start/" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Projects & rules", link: "/guides/projects-rules/" },
            { label: "Using the editor", link: "/guides/editor/" },
            { label: "Offline dry-run", link: "/guides/dry-run/" },
            { label: "Chrome extension", link: "/guides/extension/" },
            { label: "Local runtime", link: "/guides/runtime/" },
          ],
        },
        {
          label: "Rules reference",
          items: [
            { label: "Redirects", link: "/rules/redirects/" },
            { label: "Query parameters", link: "/rules/query-params/" },
            { label: "Request & response headers", link: "/rules/headers/" },
            { label: "Mocks", link: "/rules/mocks/" },
            { label: "Response-body rewriting", link: "/rules/response-body/" },
            { label: "Request-body replacement", link: "/rules/request-body/" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", link: "/reference/cli/" },
            { label: "Extension", link: "/reference/extension/" },
            {
              label: "Platforms & capabilities",
              link: "/reference/platforms/",
            },
            { label: "Security & privacy", link: "/reference/security/" },
            { label: "Architecture", link: "/reference/architecture/" },
          ],
        },
      ],
    }),
  ],
});
