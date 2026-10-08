import type { Metadata } from "next";
import { buildDossier } from "@/lib/dossier";
import { sampleDossierInput } from "@/lib/dossier-sample";
import { DemoFile } from "./demo-file";

export const metadata: Metadata = { title: { absolute: "Shaar demo" }, robots: { index: false } };

export default function DemoFilePage() {
  return <DemoFile dossier={buildDossier(sampleDossierInput())} />;
}
