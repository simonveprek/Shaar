import type { Metadata } from "next";
import { LiveDossier } from "./live";

export const metadata: Metadata = { title: "File" };

export default async function DossierPage({ params }: PageProps<"/dossier/[id]">) {
  const { id } = await params;
  return <LiveDossier id={id} />;
}
