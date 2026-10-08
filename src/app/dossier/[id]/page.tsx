import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveDossier } from "./live";

export const metadata: Metadata = { title: "File" };

/**
 * The file is loaded in the browser, which reads the job id from the address.
 * The boundary lets everything around it be prerendered; the fallback is the same dark ground.
 */
export default function DossierPage() {
  return (
    <Suspense fallback={<main className="dark min-h-svh bg-background" />}>
      <LiveDossier />
    </Suspense>
  );
}
