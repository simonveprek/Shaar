import type { Metadata } from "next";
import { buildDossier } from "@/lib/dossier";
import { sampleDossierInput } from "@/lib/dossier-sample";
import { DossierView } from "../dossier-view";

export const metadata: Metadata = {
  title: "Sample file",
  description: "What a watcher could put together from public posts. A fictional subject.",
};

/** The file for a fictional subject, so the dashboard can be seen without API keys or a real person. */
export default function SampleDossierPage() {
  return <DossierView dossier={buildDossier(sampleDossierInput())} sample />;
}
