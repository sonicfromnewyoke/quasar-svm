import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "QuasarSVM",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/quasar-lang/quasar-svm" },
      ],
      sidebar: [
        { label: "Introduction", slug: "index" },
        { label: "Core API", slug: "api" },
        { label: "Accounts", slug: "accounts" },
        { label: "Tokens", slug: "tokens" },
      ],
    }),
  ],
});
