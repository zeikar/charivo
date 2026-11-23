import type { ReactNode } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import Playground from "@site/src/components/Playground";

// The playground needs WebGL and window, so it renders in the browser only,
// and loads Charivo itself with import() once mounted. Importing the module
// here is safe during the static build: nothing in it runs until it renders.
export default function PlaygroundPage(): ReactNode {
  return (
    <Layout
      title="Playground"
      description="Drive a Charivo character in your browser — no API key, no LLM."
    >
      <main className="container margin-vert--lg">
        <Heading as="h1">Playground</Heading>
        <p>Drive a Charivo character in your browser — no API key, no LLM.</p>
        <BrowserOnly fallback={<p>Loading the playground…</p>}>
          {() => <Playground />}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
